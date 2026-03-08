const Airtable = require("./airtable");

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(bodyObj),
  };
}

function authError(statusCode, message) {
  return json(statusCode, { ok: false, error: message });
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
    // ==========================
    // ENTERPRISE VIEWER
    // Lee desde Enterprise_Config.Global_Stats
    // ==========================
    if (type === "enterprise") {
      const url = Airtable.baseApi("Enterprise_Config");
      const res = await Airtable.airtableReq("GET", url);
      const record = res.records?.[0];

      if (!record) {
        return authError(404, "Enterprise config not found");
      }

      let data = {};
      try {
        data = JSON.parse(record.fields?.["Global_Stats"] || "{}");
      } catch (e) {
        console.error("Global_Stats JSON inválido:", e);
        return authError(500, "Global_Stats JSON inválido");
      }

      return json(200, {
        ok: true,
        ...data
      });
    }

    // ==========================
    // PROJECT VIEWER
    // Lee desde Projects.Executive_Data
    // ==========================
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

      return json(200, {
        ok: true,
        name: record.fields?.["Name"] || "",
        subtitle: record.fields?.["Subtitle"] || "",
        ...executiveData
      });
    }

    return authError(400, "Invalid type");
  } catch (error) {
    console.error("presentation-data error:", error);
    return authError(500, error.message || "Internal error");
  }
};
