const Airtable = require("./airtable");

exports.handler = async (event, context) => {
  const user = context?.clientContext?.user;
  if (!user) return { statusCode: 401, body: "No autorizado" };

  const { type, key } = event.queryStringParameters;

  try {
    // LÓGICA PARA ENTERPRISE (GLOBAL)
    if (type === 'enterprise') {
      // Usamos la función que ya mapea todo en airtable.js
      const { projectsRec } = await Airtable.buildProjectMaps();
      
      const projects = projectsRec.map(r => ({
        name: r.fields["Name"] || "Sin nombre",
        key: r.fields["Project Key"] || "",
        subtitle: r.fields["Subtitle"] || ""
      })).filter(p => p.key !== ""); // Solo mostrar los que tienen llave

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          stats: { total: projects.length, margin: 24.2 },
          projects: projects
        })
      };
    }

    // LÓGICA PARA PROYECTOS INDIVIDUALES
    if (type === 'project' && key) {
      const filter = `SEARCH("${key}", {Project Key})`;
      const url = `${Airtable.baseApi('Projects')}?filterByFormula=${encodeURIComponent(filter)}`;
      const response = await Airtable.airtableReq("GET", url);
      const record = response.records[0];

      if (!record) return { statusCode: 404, body: JSON.stringify({ error: "No encontrado" }) };

      let executiveData = {};
      try {
        executiveData = JSON.parse(record.fields["Executive_Data"] || "{}");
      } catch (e) { console.error("Error JSON:", e); }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          name: record.fields["Name"],
          subtitle: record.fields["Subtitle"],
          ...executiveData
        })
      };
    }
  } catch (error) {
    console.error("Error crítico:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
