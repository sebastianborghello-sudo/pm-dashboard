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
        // --- RUTA: POST /airtable/tasks ---
    if (event.httpMethod === "POST" && subpath === "tasks") {
      const body = JSON.parse(event.body || "{}");
      const { projectKey, name, description, owner, status, progress, startDate, endDate } = body;

      const { projectKeyToId } = await buildProjectMaps();
      const projectId = projectKeyToId[projectKey];
      if (!projectId) return json(400, { ok: false, error: "Project key inválido" });

      const payload = {
        fields: {
          "Project": [projectId],
          "Name": name || "",
          "Description": description || "",
          "Owner": owner || "",
          "Status": status || "pending",
          "Progress": Number(progress || 0),
          "Start Date": startDate || null,
          "End Date": endDate || null
        }
      };

      const record = await airtableReq("POST", baseApi(TABLE_TASKS), payload);
      return json(200, { ok: true, record });
    }

    // --- RUTA: PATCH /airtable/tasks/:id ---
    if (event.httpMethod === "PATCH" && subpath.startsWith("tasks/")) {
      const recordId = subpath.split("/")[1];
      const body = JSON.parse(event.body || "{}");

      const payload = {
        fields: {
          "Name": body.name || "",
          "Description": body.description || "",
          "Owner": body.owner || "",
          "Status": body.status || "pending",
          "Progress": Number(body.progress || 0),
          "Start Date": body.startDate || null,
          "End Date": body.endDate || null
        }
      };

      const record = await airtableReq("PATCH", `${baseApi(TABLE_TASKS)}/${recordId}`, payload);
      return json(200, { ok: true, record });
    }

    // --- RUTA: DELETE /airtable/tasks/:id ---
    if (event.httpMethod === "DELETE" && subpath.startsWith("tasks/")) {
      const recordId = subpath.split("/")[1];
      await airtableReq("DELETE", `${baseApi(TABLE_TASKS)}/${recordId}`);
      return json(200, { ok: true, deleted: true });
    }

    // --- RUTA: POST /airtable/cashflow ---
    if (event.httpMethod === "POST" && subpath === "cashflow") {
      const body = JSON.parse(event.body || "{}");
      const { projectKey, concept, date, type, amount, currency, party, status, notes, relatedTask } = body;

      const { projectKeyToId } = await buildProjectMaps();
      const projectId = projectKeyToId[projectKey];
      if (!projectId) return json(400, { ok: false, error: "Project key inválido" });

      const payload = {
        fields: {
          "Project": [projectId],
          "Concept": concept || "",
          "Date": date || null,
          "Type": type || "",
          "Amount": Number(amount || 0),
          "Currency": currency || "USD",
          "Party": party || "",
          "Status": status || "",
          "Notes": notes || "",
          "Related Task": relatedTask || ""
        }
      };

      const record = await airtableReq("POST", baseApi(TABLE_CASHFLOW), payload);
      return json(200, { ok: true, record });
    }

    // --- RUTA: PATCH /airtable/cashflow/:id ---
    if (event.httpMethod === "PATCH" && subpath.startsWith("cashflow/")) {
      const recordId = subpath.split("/")[1];
      const body = JSON.parse(event.body || "{}");

      const payload = {
        fields: {
          "Concept": body.concept || "",
          "Date": body.date || null,
          "Type": body.type || "",
          "Amount": Number(body.amount || 0),
          "Currency": body.currency || "USD",
          "Party": body.party || "",
          "Status": body.status || "",
          "Notes": body.notes || "",
          "Related Task": body.relatedTask || ""
        }
      };

      const record = await airtableReq("PATCH", `${baseApi(TABLE_CASHFLOW)}/${recordId}`, payload);
      return json(200, { ok: true, record });
    }

    // --- RUTA: DELETE /airtable/cashflow/:id ---
    if (event.httpMethod === "DELETE" && subpath.startsWith("cashflow/")) {
      const recordId = subpath.split("/")[1];
      await airtableReq("DELETE", `${baseApi(TABLE_CASHFLOW)}/${recordId}`);
      return json(200, { ok: true, deleted: true });
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



const handler = exports.handler;

module.exports = {
  handler,
  airtableReq,
  baseApi,
  fetchAll,
  buildProjectMaps,
  getUser,
  getRoles,
  hasSomeRole
};
