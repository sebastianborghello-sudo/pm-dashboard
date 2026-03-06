// netlify/functions/presentation-data.js
const airtableModule = require("./airtable"); 

exports.handler = async (event, context) => {
  const user = context?.clientContext?.user;
  if (!user) return { statusCode: 401, body: "No autorizado" };

  const { type, key } = event.queryStringParameters;

  try {
    // LÓGICA PARA PROYECTOS INDIVIDUALES
    if (type === 'project' && key) {
      // Usamos las funciones exportadas de airtable.js
      const filter = `SEARCH("${key}", {Project Key})`;
      // Nota: Asegúrate que baseApi y airtableReq estén disponibles
      const url = `${airtableModule.baseApi('Projects')}?filterByFormula=${encodeURIComponent(filter)}`;
      const response = await airtableModule.airtableReq("GET", url);
      
      const record = response.records[0];
      if (!record) return { statusCode: 404, body: JSON.stringify({ error: "Proyecto no encontrado" }) };

      // Parseamos el JSON del campo que creaste en Airtable
      const executiveData = JSON.parse(record.fields["Executive_Data"] || "{}");

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: record.fields["Name"],
          subtitle: record.fields["Subtitle"],
          ...executiveData
        })
      };
    }

    // LÓGICA PARA ENTERPRISE (GLOBAL)
    if (type === 'enterprise') {
      const url = `${airtableModule.baseApi('Projects')}?sort%5B0%5D%5Bfield%5D=Name`;
      const response = await airtableModule.airtableReq("GET", url);
      
      const projects = response.records.map(r => ({
        name: r.fields["Name"],
        key: r.fields["Project Key"],
        subtitle: r.fields["Subtitle"]
      }));

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stats: { total: projects.length, margin: 24.2 },
          projects: projects
        })
      };
    }
  } catch (error) {
    console.error("Error en la función:", error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: error.message }) 
    };
  }
};
