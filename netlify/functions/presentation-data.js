// netlify/functions/presentation-data.js
const { buildProjectMaps, airtableReq, baseApi, TABLE_PROJECTS } = require("./airtable"); // Reutilizamos lógica de airtable.js

exports.handler = async (event, context) => {
  const user = context?.clientContext?.user || null;
  const roles = user?.app_metadata?.roles || [];
  
  // 1. Validación de Autenticación
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: "No autorizado" }) };
  }

  const { type, key } = event.queryStringParameters;

  // 2. Lógica de permisos por tipo de contenido
  if (type === 'enterprise') {
    if (!roles.some(r => ["pm_admin", "pm_viewer"].includes(r))) {
      return { statusCode: 403, body: JSON.stringify({ error: "Permisos insuficientes para Enterprise" }) };
    }
    // Aquí retornarías los datos que antes estaban "hardcodeados" en dashboard-enterprise.html
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        title: "Sanbai · Executive Update",
        metrics: { progress: 65, totalBudget: "1.2M" },
        // ... otros datos del dashboard
      })
    };
  }

  if (type === 'project' && key) {
    if (!roles.some(r => ["pm_admin", "pm_editor", "pm_viewer"].includes(r))) {
      return { statusCode: 403, body: JSON.stringify({ error: "Permisos insuficientes para Proyectos" }) };
    }
    
    // Simulación de búsqueda de datos por 'key' (macro_lan, storage_backup, etc.)
    // Podrías consultar Airtable usando el key para obtener los datos específicos
    return {
      statusCode: 200,
      body: JSON.stringify({
        projectKey: key,
        name: key === 'macro_lan' ? "Renovación LAN Torre Macro" : "Proyecto " + key,
        // ... datos específicos del proyecto
      })
    };
  }

  return { statusCode: 400, body: JSON.stringify({ error: "Tipo de solicitud inválido" }) };
};
