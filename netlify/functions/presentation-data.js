const { airtableReq, baseApi } = require("./airtable");

exports.handler = async (event, context) => {
  const user = context?.clientContext?.user;
  if (!user) return { statusCode: 401, body: "No autorizado" };

  const { type, key } = event.queryStringParameters;

  // Dentro de exports.handler en netlify/functions/presentation-data.js

if (type === 'enterprise') {
    // Traemos todos los proyectos para el dashboard global
    const url = `${baseApi('Projects')}?sort%5B0%5D%5Bfield%5D=Name`;
    const response = await airtableReq("GET", url);
    
    const projects = response.records.map(r => ({
      name: r.fields["Name"],
      key: r.fields["Project Key"],
      subtitle: r.fields["Subtitle"]
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        stats: {
          total: projects.length,
          margin: 24.2 // Esto podrías calcularlo dinámicamente si tienes el dato en Airtable
        },
        projects: projects
      })
    };
}

  // LÓGICA PARA PROYECTOS
  if (type === 'project' && key) {
    const filter = `SEARCH("${key}", {Project Key})`;
    const url = `${baseApi('Projects')}?filterByFormula=${encodeURIComponent(filter)}`;
    const response = await airtableReq("GET", url);
    const record = response.records[0];

    if (!record) return { statusCode: 404, body: "No encontrado" };

    // Extraemos el JSON del campo que creaste
    const executiveData = JSON.parse(record.fields["Executive_Data"] || "{}");

    return {
      statusCode: 200,
      body: JSON.stringify({
        name: record.fields["Name"],
        subtitle: record.fields["Subtitle"],
        ...executiveData
      })
    };
  }

  // LÓGICA PARA ENTERPRISE (Global)
  if (type === 'enterprise') {
    // Aquí puedes traer el resumen de la nueva tabla Enterprise_Config
    // O simplemente devolver un resumen de todos los proyectos
    return {
      statusCode: 200,
      body: JSON.stringify({
        title: "UDN Enterprise - Control Tower",
        active_projects: 3,
        total_margin: "24.2%"
      })
    };
  }
};
