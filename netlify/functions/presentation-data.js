// netlify/functions/presentation-data.js
const { airtableReq, baseApi, TABLE_PROJECTS } = require("./airtable");

exports.handler = async (event, context) => {
  const user = context?.clientContext?.user;
  if (!user) return { statusCode: 401, body: "Sin acceso" };

  const { type, key } = event.queryStringParameters;

  // Lógica para PROYECTOS individuales
  if (type === 'project' && key) {
    // 1. Buscamos en Airtable el proyecto por su KEY
    const filter = `SEARCH("${key}", {Project Key})`;
    const url = `${baseApi('Projects')}?filterByFormula=${encodeURIComponent(filter)}`;
    const response = await airtableReq("GET", url);
    const project = response.records[0];

    if (!project) return { statusCode: 404, body: "Proyecto no encontrado" };

    // 2. Construimos la respuesta dinámica
    return {
      statusCode: 200,
      body: JSON.stringify({
        name: project.fields["Name"],
        subtitle: project.fields["Subtitle"],
        objective: project.fields["Objective"] || "Sin objetivo definido.",
        // Aquí podrías enviar más datos (presupuesto, progreso, etc.)
      })
    };
  }
  
  return { statusCode: 400, body: "Petición inválida" };
};
