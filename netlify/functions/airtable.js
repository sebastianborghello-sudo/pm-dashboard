/**
 * Netlify Function: airtable.js
 * Rutas:
 *   GET    /.netlify/functions/airtable                      -> { projects: { [projectKey]: {meta,tasks,team,critical,cashflow} } }
 *   POST   /.netlify/functions/airtable/tasks                -> crea tarea
 *   PATCH  /.netlify/functions/airtable/tasks/:recordId      -> actualiza tarea
 *   POST   /.netlify/functions/airtable/cashflow             -> crea evento cashflow
 *   PATCH  /.netlify/functions/airtable/cashflow/:recordId   -> actualiza evento cashflow
 *
 * Requisitos ENV:
 *   AIRTABLE_API_KEY
 *   AIRTABLE_BASE_ID
 *
 * Tablas y campos esperados (Airtable):
 *   Projects:
 *     - projectKey (text)  // ej: macro_lan
 *     - name, subtitle, statusLabel, client, amount, start, end, pm, ganttStart, ganttEnd (opcionales)
 *   Tasks:
 *     - Project (link to Projects)
 *     - Name, Description, Owner, Status, Progress, StartDate, EndDate (nombres se pueden ajustar abajo)
 *   Team:
 *     - Project (link to Projects)
 *     - Name, Role, Initials
 *   Critical:
 *     - Project (link to Projects)
 *     - Item (text)
 *   Cashflow:
 *     - Project (link to Projects)
 *     - Date (date)
 *     - Type (single select: Cobro/Pago)
 *     - Concept (text)
 *     - Counterparty (text)
 *     - Amount (number)
 *     - Currency (text)
 *     - Status (single select)
 *     - Notes (long text)
 */

const Airtable = require("airtable");

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  console.warn("Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID env vars.");
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

// Table names
const TABLE_PROJECTS = "Projects";
const TABLE_TASKS = "Tasks";
const TABLE_TEAM = "Team";
const TABLE_CRITICAL = "Critical";
const TABLE_CASHFLOW = "Cashflow";

// Field mapping (adjust if your Airtable field names differ)
const F = {
  // Projects
  projectKey: "projectKey",
  name: "name",
  subtitle: "subtitle",
  statusLabel: "statusLabel",
  client: "client",
  amount: "amount",
  start: "start",
  end: "end",
  pm: "pm",
  ganttStart: "ganttStart",
  ganttEnd: "ganttEnd",

  // Tasks
  taskProject: "Project",
  taskName: "Name",
  taskDescription: "Description",
  taskOwner: "Owner",
  taskStatus: "Status",
  taskProgress: "Progress",
  taskStartDate: "StartDate",
  taskEndDate: "EndDate",

  // Team
  teamProject: "Project",
  teamName: "Name",
  teamRole: "Role",
  teamInitials: "Initials",

  // Critical
  criticalProject: "Project",
  criticalItem: "Item",

  // Cashflow
  cfProject: "Project",
  cfDate: "Date",
  cfType: "Type",
  cfConcept: "Concept",
  cfCounterparty: "Counterparty",
  cfAmount: "Amount",
  cfCurrency: "Currency",
  cfStatus: "Status",
  cfNotes: "Notes",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify(obj),
  };
}

function parsePath(path) {
  // path examples:
  //   /.netlify/functions/airtable
  //   /.netlify/functions/airtable/tasks
  //   /.netlify/functions/airtable/tasks/recXXXX
  //   /.netlify/functions/airtable/cashflow
  //   /.netlify/functions/airtable/cashflow/recXXXX
  const clean = (path || "").split("?")[0];
  const parts = clean.split("/").filter(Boolean);
  // find "airtable" index
  const i = parts.findIndex((p) => p === "airtable");
  if (i < 0) return { resource: "", id: "" };
  const resource = parts[i + 1] || "";
  const id = parts[i + 2] || "";
  return { resource, id };
}

async function fetchAll(tableName) {
  // Returns array of records. If table does not exist, returns [] (so dashboard doesn't crash).
  try {
    const records = [];
    await base(tableName)
      .select({ pageSize: 100 })
      .eachPage((pageRecords, fetchNextPage) => {
        records.push(...pageRecords);
        fetchNextPage();
      });
    return records;
  } catch (err) {
    // Airtable throws for missing table; we degrade gracefully.
    console.warn(`fetchAll failed for table '${tableName}':`, err?.message || err);
    return [];
  }
}

function projectMetaFromRecord(r) {
  const f = r.fields || {};
  return {
    name: f[F.name] || f["Name"] || "Proyecto",
    subtitle: f[F.subtitle] || "",
    statusLabel: f[F.statusLabel] || "",
    client: f[F.client] || "",
    amount: f[F.amount] || "",
    start: f[F.start] || "",
    end: f[F.end] || "",
    pm: f[F.pm] || "",
    ganttStart: f[F.ganttStart] || "",
    ganttEnd: f[F.ganttEnd] || "",
  };
}

function taskFromRecord(r) {
  const f = r.fields || {};
  return {
    recordId: r.id,
    name: f[F.taskName] || "",
    description: f[F.taskDescription] || "",
    owner: f[F.taskOwner] || "",
    status: f[F.taskStatus] || "pending",
    progress: Number(f[F.taskProgress] || 0),
    startDate: f[F.taskStartDate] || "",
    endDate: f[F.taskEndDate] || "",
  };
}

function teamFromRecord(r) {
  const f = r.fields || {};
  return {
    name: f[F.teamName] || "",
    role: f[F.teamRole] || "",
    initials: f[F.teamInitials] || "",
  };
}

function criticalFromRecord(r) {
  const f = r.fields || {};
  return f[F.criticalItem] || "";
}

function cashflowFromRecord(r) {
  const f = r.fields || {};
  return {
    recordId: r.id,
    date: f[F.cfDate] || "",
    type: f[F.cfType] || "",
    concept: f[F.cfConcept] || "",
    counterparty: f[F.cfCounterparty] || "",
    amount: Number(f[F.cfAmount] || 0),
    currency: f[F.cfCurrency] || "USD",
    status: f[F.cfStatus] || "",
    notes: f[F.cfNotes] || "",
  };
}

async function getProjectsPayload() {
  const [projRecs, taskRecs, teamRecs, critRecs, cfRecs] = await Promise.all([
    fetchAll(TABLE_PROJECTS),
    fetchAll(TABLE_TASKS),
    fetchAll(TABLE_TEAM),
    fetchAll(TABLE_CRITICAL),
    fetchAll(TABLE_CASHFLOW),
  ]);

  const projects = {};
  const projectIdToKey = {};

  // Build projects + id map
  for (const pr of projRecs) {
    const key = pr.fields?.[F.projectKey];
    if (!key) continue;
    projects[key] = {
      meta: projectMetaFromRecord(pr),
      tasks: [],
      team: [],
      critical: [],
      cashflow: [],
    };
    projectIdToKey[pr.id] = key;
  }

  // Helper: find projectKey from linked Project field
  function keyFromLinkedProjectField(recordFields, fieldName) {
    const linked = recordFields?.[fieldName];
    if (Array.isArray(linked) && linked.length) {
      const id = linked[0];
      return projectIdToKey[id] || null;
    }
    return null;
  }

  // Tasks
  for (const tr of taskRecs) {
    const key = keyFromLinkedProjectField(tr.fields, F.taskProject);
    if (!key || !projects[key]) continue;
    projects[key].tasks.push(taskFromRecord(tr));
  }

  // Team
  for (const mr of teamRecs) {
    const key = keyFromLinkedProjectField(mr.fields, F.teamProject);
    if (!key || !projects[key]) continue;
    projects[key].team.push(teamFromRecord(mr));
  }

  // Critical
  for (const cr of critRecs) {
    const key = keyFromLinkedProjectField(cr.fields, F.criticalProject);
    if (!key || !projects[key]) continue;
    projects[key].critical.push(criticalFromRecord(cr));
  }

  // Cashflow
  for (const cf of cfRecs) {
    const key = keyFromLinkedProjectField(cf.fields, F.cfProject);
    if (!key || !projects[key]) continue;
    projects[key].cashflow.push(cashflowFromRecord(cf));
  }

  return { projects, projectIdToKey };
}

async function getProjectIdByKey(projectKey) {
  const pr = await base(TABLE_PROJECTS)
    .select({ maxRecords: 1, filterByFormula: `{${F.projectKey}} = '${String(projectKey).replace(/'/g, "\\'")}'` })
    .firstPage();

  const rec = pr?.[0];
  return rec ? rec.id : null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders, body: "" };

    const { resource, id } = parsePath(event.path);
    const method = event.httpMethod;

    // GET base payload
    if (method === "GET" && !resource) {
      const payload = await getProjectsPayload();
      return json(200, { ok: true, projects: payload.projects });
    }

    // ===== TASKS =====
    if (resource === "tasks" && method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const projectKey = body.projectKey;
      if (!projectKey) return json(400, { ok: false, error: "projectKey requerido" });

      const projectId = await getProjectIdByKey(projectKey);
      if (!projectId) return json(400, { ok: false, error: "projectKey inválido (no existe en Projects)" });

      const created = await base(TABLE_TASKS).create([
        {
          fields: {
            [F.taskProject]: [projectId],
            [F.taskName]: body.name || "",
            [F.taskDescription]: body.description || "",
            [F.taskOwner]: body.owner || "",
            [F.taskStatus]: body.status || "pending",
            [F.taskProgress]: Number(body.progress || 0),
            [F.taskStartDate]: body.startDate || "",
            [F.taskEndDate]: body.endDate || "",
          },
        },
      ]);

      const rec = created?.[0];
      return json(200, { ok: true, record: rec ? { id: rec.id } : null });
    }

    if (resource === "tasks" && method === "PATCH" && id) {
      const body = JSON.parse(event.body || "{}");
      const updated = await base(TABLE_TASKS).update([
        {
          id,
          fields: {
            ...(body.name !== undefined ? { [F.taskName]: body.name } : {}),
            ...(body.description !== undefined ? { [F.taskDescription]: body.description } : {}),
            ...(body.owner !== undefined ? { [F.taskOwner]: body.owner } : {}),
            ...(body.status !== undefined ? { [F.taskStatus]: body.status } : {}),
            ...(body.progress !== undefined ? { [F.taskProgress]: Number(body.progress || 0) } : {}),
            ...(body.startDate !== undefined ? { [F.taskStartDate]: body.startDate } : {}),
            ...(body.endDate !== undefined ? { [F.taskEndDate]: body.endDate } : {}),
          },
        },
      ]);
      const rec = updated?.[0];
      return json(200, { ok: true, record: rec ? { id: rec.id } : null });
    }

    // ===== CASHFLOW =====
    if (resource === "cashflow" && method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const projectKey = body.projectKey;
      if (!projectKey) return json(400, { ok: false, error: "projectKey requerido" });

      const projectId = await getProjectIdByKey(projectKey);
      if (!projectId) return json(400, { ok: false, error: "projectKey inválido (no existe en Projects)" });

      const created = await base(TABLE_CASHFLOW).create([
        {
          fields: {
            [F.cfProject]: [projectId],
            [F.cfDate]: body.date || "",
            [F.cfType]: body.type || "",
            [F.cfConcept]: body.concept || "",
            [F.cfCounterparty]: body.counterparty || "",
            [F.cfAmount]: Number(body.amount || 0),
            [F.cfCurrency]: body.currency || "USD",
            [F.cfStatus]: body.status || "",
            [F.cfNotes]: body.notes || "",
          },
        },
      ]);

      const rec = created?.[0];
      return json(200, { ok: true, record: rec ? { id: rec.id } : null });
    }

    if (resource === "cashflow" && method === "PATCH" && id) {
      const body = JSON.parse(event.body || "{}");

      const updated = await base(TABLE_CASHFLOW).update([
        {
          id,
          fields: {
            ...(body.date !== undefined ? { [F.cfDate]: body.date } : {}),
            ...(body.type !== undefined ? { [F.cfType]: body.type } : {}),
            ...(body.concept !== undefined ? { [F.cfConcept]: body.concept } : {}),
            ...(body.counterparty !== undefined ? { [F.cfCounterparty]: body.counterparty } : {}),
            ...(body.amount !== undefined ? { [F.cfAmount]: Number(body.amount || 0) } : {}),
            ...(body.currency !== undefined ? { [F.cfCurrency]: body.currency } : {}),
            ...(body.status !== undefined ? { [F.cfStatus]: body.status } : {}),
            ...(body.notes !== undefined ? { [F.cfNotes]: body.notes } : {}),
          },
        },
      ]);

      const rec = updated?.[0];
      return json(200, { ok: true, record: rec ? { id: rec.id } : null });
    }

    return json(404, { ok: false, error: "Ruta no encontrada" });
  } catch (err) {
    console.error("Function error:", err);
    return json(500, { ok: false, error: err?.message || String(err) });
  }
};
