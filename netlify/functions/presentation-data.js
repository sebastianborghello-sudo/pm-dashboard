const Airtable = require("./airtable");

function authError(statusCode, message) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ ok: false, error: message }),
  };
}

function requireRead(context) {
  const user = Airtable.getUser(context);
  if (!user) return authError(401, "Unauthorized");
  if (!Airtable.hasSomeRole(context, ["pm_admin", "pm_editor", "pm_viewer"])) {
    return authError(403, "Forbidden");
  }
  return null;
}

exports.handler = async (event, context) => {
  const denied = requireRead(context);
  if (denied) return denied;

  const qs = event.queryStringParameters || {};
  const type = qs.type;
  const key = qs.key;

  try {
    if (type === "enterprise") {
      const { projectsRec } = await Airtable.buildProjectMaps();

      const projects = projectsRec
        .map(r => ({
          name: r.fields?.["Name"] || "Sin nombre",
          key: r.fields?.["Project Key"] || "",
          subtitle: r.fields?.["Subtitle"] || ""
        }))
        .filter(p => p.key);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          ok: true,
          stats: {
            total: projects.length,
            margin: 24.2
          },
          projects
        })
      };
    }

    if (type === "project") {
      if (!key) return authError(400, "Missing project key");

      const filter = `SEARCH("${key}", {Project Key})`;
      const url = `${Airtable.baseApi("Projects")}?filterByFormula=${encodeURIComponent(filter)}`;
      const response = await Airtable.airtableReq("GET", url);
      const record = response.records?.[0];

      if (!record) return authError(404, "Project not found");

      let executiveData = {};
      try {
        executiveData = JSON.parse(record.fields?.["Executive_Data"] || "{}");
      } catch (e) {
        console.error("Executive_Data JSON inválido:", e);
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          ok: true,
          name: record.fields?.["Name"] || "",
          subtitle: record.fields?.["Subtitle"] || "",
          objective: executiveData.objective || "",
          kpis: Array.isArray(executiveData.kpis) ? executiveData.kpis : [],
          scope: Array.isArray(executiveData.scope) ? executiveData.scope : []
        })
      };
    }

    return authError(400, "Invalid type");
  } catch (error) {
    console.error("presentation-data error:", error);
    return authError(500, error.message || "Internal error");
  }
};
