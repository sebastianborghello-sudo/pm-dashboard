const { airtableReq, baseApi, TABLE_PROJECTS } = require("./airtable");

exports.handler = async (event, context) => {
  const user = context?.clientContext?.user || null;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "No Auth" }) };

  const { type, key } = event.queryStringParameters;

  // Si es proyecto, buscamos el record específico en Airtable
  if (type === 'project' && key) {
    try {
      // Nota: Asumo que tienes una forma de buscar por el campo 'Project Key' en Airtable
      const formula = `ENCODE_URL_COMPONENT({Project Key} = '${key}')`;
      const response = await airtableReq("GET", `${baseApi(TABLE_PROJECTS)}?filterByFormula=${formula}`);
      
      if (response.records.length === 0) return { statusCode: 404, body: JSON.stringify({ error: "No encontrado" }) };
      
      const projectData = response.records[0].fields;
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectData)
      };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: "Error al consultar Airtable" }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: "Tipo inválido" }) };
};
