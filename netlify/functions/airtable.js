// netlify/functions/airtable.js

// 1. Constantes y Configuración (Nivel Superior)
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TOKEN = process.env.AIRTABLE_TOKEN;

const TABLE_PROJECTS = "Projects";
const TABLE_TASKS = "Tasks";
const TABLE_TEAM = "Team";
const TABLE_CRITICAL = "Critical";
const TABLE_CASHFLOW = "Cashflow";

// 2. Funciones de Utilidad y Autenticación
function getUser(context) {
  return context?.clientContext?.user || null;
}

function getRoles(context) {
  const user = getUser(context);
  return user?.app_metadata?.roles || [];
}

function hasSomeRole(context, allowed = []) {
  const roles = getRoles(context);
  return allowed.some(r => roles.includes(r));
}

function authError(statusCode, message) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify({ ok: false, error: message }),
  };
}

function requireRead(context) {
  const user = getUser(context);
  if (!user) return authError(401, "Unauthorized");
  if (!hasSomeRole(context, ["pm_admin", "pm_editor", "pm_viewer"])) {
    return authError(403, "Forbidden");
  }
  return null;
}

function requireWrite(context) {
  const user = getUser(context);
  if (!user) return authError(401, "Unauthorized");
  if (!hasSomeRole(context, ["pm_admin", "pm_editor"])) {
    return authError(403, "Forbidden");
  }
  return null;
}

// 3. Funciones de Comunicación con Airtable (Exportables)
const baseApi = (table) =>
  `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;

const listApi = (table) => `${baseApi(table)}?pageSize=100`;

async function airtableReq(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    throw new Error(`Airtable error: ${r.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function fetchAll(table) {
  let out = [];
  let offset = null;
  while (true) {
    const url = offset ? `${listApi(table)}&offset=${offset}` : listApi(table);
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!r.ok) throw new Error(`Error fetching ${table}: ${r.status}`);
    const data = await r.json();
    out = out.concat(data.records || []);
    if (!data.offset) break;
    offset = data.offset;
  }
  return out;
}

async function buildProjectMaps() {
  const projectsRec = await fetchAll(TABLE_PROJECTS);
  const projectIdToKey = {};
  const projectKeyToId = {};
  for (const p of projectsRec) {
    const key = p.fields?.["Project Key"];
    if (!key) continue;
    projectIdToKey[p.id] = key;
    projectKeyToId[key] = p.id;
  }
  return { projectsRec, projectIdToKey, projectKeyToId };
}

// 4. Handler Principal
exports.handler = async (event, context) => {
  const json = (statusCode, bodyObj) => ({
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    },
    body: JSON.stringify(bodyObj),
  });

  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (!BASE_ID || !TOKEN) return json(500, { error: "Missing Env Vars" });

    // Validación de Seguridad
    if (event.httpMethod === "GET") {
      const denied = requireRead(context);
      if (denied) return denied;
    } else {
      const denied = requireWrite(context);
      if (denied) return denied;
    }

    const path = event.path || "";
    const subpath = path.replace("/.netlify/functions/airtable", "").replace(/^\/+/, "");

    // --- RUTA: GET /airtable (Esta es la que llena el Dashboard PM) ---
    if (event.httpMethod === "GET" && (subpath === "" || subpath === "projects")) {
      const { projectsRec, projectIdToKey } = await buildProjectMaps();

      const [tasksRec, teamRec, criticalRec, cashflowRec] = await Promise.all([
        fetchAll(TABLE_TASKS),
        fetchAll(TABLE_TEAM),
        fetchAll(TABLE_CRITICAL),
        fetchAll(TABLE_CASHFLOW),
      ]);

      const projects = {};

      // 1. Inicializar estructura de proyectos
      for (const p of projectsRec) {
        const pf = p.fields || {};
        const key = pf["Project Key"];
        if (!key) continue;

        projects[key] = {
          meta: {
            name: pf["Name"] || "",
            subtitle: pf["Subtitle"] || "",
            statusLabel: pf["Status Label"] || "",
            client: pf["Client"] || "",
            amount: pf["Amount"] || "",
            start: pf["Start Display"] || "",
            end: pf["End Display"] || "",
            pm: pf["PM"] || "",
            ganttStart: pf["Gantt Start"] || null,
            ganttEnd: pf["Gantt End"] || null,
          },
          tasks: [], team: [], critical: [], cashflow: [],
        };
      }

      // 2. Mapear Tareas
      tasksRec.forEach(t => {
        const projLink = t.fields["Project"];
        const projId = Array.isArray(projLink) ? projLink[0] : projLink;
        const key = projectIdToKey[projId];
        if (projects[key]) {
          projects[key].tasks.push({
            recordId: t.id,
            id: t.fields["Task ID"],
            name: t.fields["Name"],
            status: t.fields["Status"],
            progress: t.fields["Progress"] || 0,
            owner: t.fields["Owner"],
            startDate: t.fields["Start Date"],
            endDate: t.fields["End Date"],
            description: t.fields["Description"]
          });
        }
      });

      // 3. Mapear Equipo
      teamRec.forEach(m => {
        const projId = Array.isArray(m.fields["Project"]) ? m.fields["Project"][0] : m.fields["Project"];
        const key = projectIdToKey[projId];
        if (projects[key]) {
          projects[key].team.push({
            name: m.fields["Name"],
            role: m.fields["Role"],
            initials: m.fields["Initials"]
          });
        }
      });

      // 4. Mapear Cashflow
      cashflowRec.forEach(c => {
        const projId = Array.isArray(c.fields["Project"]) ? c.fields["Project"][0] : c.fields["Project"];
        const key = projectIdToKey[projId];
        if (projects[key]) {
          projects[key].cashflow.push({
            recordId: c.id,
            concept: c.fields["Concept"],
            amount: c.fields["Amount"],
            type: c.fields["Type"],
            status: c.fields["Status"],
            date: c.fields["Date"]
          });
        }
      });

      return json(200, { ok: true, projects });
    }

    return json(404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    return json(500, { ok: false, error: String(e) });
  }
};

// ESTA ES LA PARTE CRÍTICA QUE FALTA O ESTÁ MAL:
// Netlify busca "exports.handler", pero Node busca "module.exports"
// Para que ambos funcionen, debemos unificarlos así:

const handler = exports.handler; // Guardamos el handler que ya definiste arriba

module.exports = {
  handler,           // Esto permite que Netlify encuentre la función
  airtableReq,       // Esto permite que presentation-data.js use la función
  baseApi,           // Esto permite que presentation-data.js use la función
  getUser,
  getRoles
};
