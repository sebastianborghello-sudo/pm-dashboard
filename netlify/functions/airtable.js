// netlify/functions/airtable.js
// Reads + writes Projects/Tasks/Team/Critical + Cashflow from Airtable.
// Endpoints:
//   GET    /.netlify/functions/airtable            -> { projects: { ... } }
//   POST   /.netlify/functions/airtable/tasks      -> create task
//   PATCH  /.netlify/functions/airtable/tasks/:id  -> update task
//   DELETE /.netlify/functions/airtable/tasks/:id  -> delete task
//   POST   /.netlify/functions/airtable/cashflow      -> create cash event
//   PATCH  /.netlify/functions/airtable/cashflow/:id  -> update cash event
//   DELETE /.netlify/functions/airtable/cashflow/:id  -> delete cash event

exports.handler = async (event) => {
  try {
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TOKEN = process.env.AIRTABLE_TOKEN;

    const TABLE_PROJECTS = "Projects";
    const TABLE_TASKS = "Tasks";
    const TABLE_TEAM = "Team";
    const TABLE_CRITICAL = "Critical";
    const TABLE_CASHFLOW = "Cashflow"; // <-- Crear en Airtable (o renombrar aquí)

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    };

    // CORS / preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: corsHeaders, body: "" };
    }

    if (!BASE_ID || !TOKEN) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: false, error: "Missing env vars AIRTABLE_BASE_ID / AIRTABLE_TOKEN" }),
      };
    }

    const apiList = (table) =>
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?pageSize=100`;

    async function fetchAll(table) {
      let out = [];
      let offset = null;

      while (true) {
        const url = offset ? `${apiList(table)}&offset=${offset}` : apiList(table);
        const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });

        if (!r.ok) {
          const t = await r.text();
          throw new Error(`Airtable error ${table}: ${r.status} ${t}`);
        }

        const data = await r.json();
        out = out.concat(data.records || []);
        if (!data.offset) break;
        offset = data.offset;
      }
      return out;
    }

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
        throw new Error(`Airtable write error: ${r.status} ${JSON.stringify(data)}`);
      }
      return data;
    }

    // Helper: construir mapas projectKey <-> recordId
    async function buildProjectMaps() {
      const projectsRec = await fetchAll(TABLE_PROJECTS);

      const projectIdToKey = {}; // recId -> "macro_lan"
      const projectKeyToId = {}; // "macro_lan" -> recId

      for (const p of projectsRec) {
        const pf = p.fields || {};
        const key = pf["Project Key"];
        if (!key) continue;
        projectIdToKey[p.id] = key;
        projectKeyToId[key] = p.id;
      }

      return { projectsRec, projectIdToKey, projectKeyToId };
    }

    // ===== Routing =====
    const path = event.path || "";
    const base = "/.netlify/functions/airtable";
    const rest = path.startsWith(base) ? path.slice(base.length) : "";
    const subpath = rest.replace(/^\/+/, ""); // "", "tasks", "tasks/recXXXX", "cashflow", ...

    const json = (statusCode, bodyObj) => ({
      statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(bodyObj),
    });

    const normalizeCashType = (v) => {
      const s = String(v || "").toLowerCase().trim();
      if (!s) return "out";
      if (["in", "cobro", "cobrar", "ingreso", "income", "cobr", "inflow"].some((k) => s.includes(k))) return "in";
      if (["out", "pago", "egreso", "expense", "outflow", "pay"].some((k) => s.includes(k))) return "out";
      // default: out
      return "out";
    };

    // ==========================
    // GET (Dashboard)
    // ==========================
    if (event.httpMethod === "GET" && (subpath === "" || subpath === "projects")) {
      const { projectsRec, projectIdToKey } = await buildProjectMaps();

      const [tasksRec, teamRec, criticalRec, cashRec] = await Promise.all([
        fetchAll(TABLE_TASKS),
        fetchAll(TABLE_TEAM),
        fetchAll(TABLE_CRITICAL),
        fetchAll(TABLE_CASHFLOW).catch(() => []), // si aún no existe, no rompe
      ]);

      const projects = {};

      // Projects
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
            ganttStart: pf["Gantt Start"] ? new Date(pf["Gantt Start"]).toISOString().slice(0, 10) : null,
            ganttEnd: pf["Gantt End"] ? new Date(pf["Gantt End"]).toISOString().slice(0, 10) : null,
          },
          tasks: [],
          team: [],
          critical: [],
          cashflow: [],
        };
      }

      // Tasks
      for (const t of tasksRec) {
        const tf = t.fields || {};
        const proj = tf["Project"];
        const linkedId = Array.isArray(proj) ? proj[0] : proj;
        const projectKey = projectIdToKey[linkedId] || linkedId;
        if (!projectKey || !projects[projectKey]) continue;

        projects[projectKey].tasks.push({
          recordId: t.id,
          id: tf["Task ID"] ?? null,
          name: tf["Name"] || "",
          description: tf["Description"] || "",
          owner: tf["Owner"] || "",
          status: tf["Status"] || "pending",
          progress: Number(tf["Progress"] ?? 0),
          startDate: tf["Start Date"] ? new Date(tf["Start Date"]).toISOString().slice(0, 10) : "",
          endDate: tf["End Date"] ? new Date(tf["End Date"]).toISOString().slice(0, 10) : "",
        });
      }

      // Team
      for (const m of teamRec) {
        const mf = m.fields || {};
        const proj = mf["Project"];
        const linkedId = Array.isArray(proj) ? proj[0] : proj;
        const projectKey = projectIdToKey[linkedId] || linkedId;
        if (!projectKey || !projects[projectKey]) continue;

        projects[projectKey].team.push({
          name: mf["Name"] || "",
          role: mf["Role"] || "",
          initials: mf["Initials"] || "",
        });
      }

      // Critical
      for (const c of criticalRec) {
        const cf = c.fields || {};
        const proj = cf["Project"];
        const linkedId = Array.isArray(proj) ? proj[0] : proj;
        const projectKey = projectIdToKey[linkedId] || linkedId;
        if (!projectKey || !projects[projectKey]) continue;

        projects[projectKey].critical.push(cf["Text"] || "");
      }

      // Cashflow
      for (const c of cashRec) {
        const cf = c.fields || {};
        const proj = cf["Project"];
        const linkedId = Array.isArray(proj) ? proj[0] : proj;
        const projectKey = projectIdToKey[linkedId] || linkedId;
        if (!projectKey || !projects[projectKey]) continue;

        const typeRaw = cf["Type"] ?? cf["Movimiento"] ?? cf["Flow"] ?? cf["Direction"];
        const amountRaw = cf["Amount"] ?? cf["Monto"] ?? 0;

        party.push({
          recordId: c.id,
          type: normalizeCashType(typeRaw),
          description: cf["Description"] || "",
          Counterparty: cf["Counterparty"] ?? cf["Proveedor/Cliente"] ?? cf["Contraparte"] ?? "",
          amount: Number(amountRaw ?? 0),
          date: cf["Date"] ? new Date(cf["Date"]).toISOString().slice(0, 10) : (cf["Fecha"] ? new Date(cf["Fecha"]).toISOString().slice(0, 10) : ""),
          status: cf["Status"] ?? cf["Estado"] ?? "",
        });
      }

      return json(200, { ok: true, projects });
    }

    // ==========================
    // POST /tasks  (crear task)
    // ==========================
    if (event.httpMethod === "POST" && subpath === "tasks") {
      const payload = JSON.parse(event.body || "{}");
      const { projectKey } = payload;

      if (!projectKey) return json(400, { ok: false, error: "Missing projectKey" });

      const { projectKeyToId } = await buildProjectMaps();
      const projectRecordId = projectKeyToId[projectKey];
      if (!projectRecordId) return json(400, { ok: false, error: `Unknown projectKey: ${projectKey}` });

      const fields = {
        "Project": [projectRecordId],
        "Name": payload.name || "",
        "Description": payload.description || "",
        "Owner": payload.owner || "",
        "Status": payload.status || "pending",
        "Progress": Number(payload.progress ?? 0),
        ...(payload.startDate ? { "Start Date": payload.startDate } : {}),
        ...(payload.endDate ? { "End Date": payload.endDate } : {}),
      };

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_TASKS)}`;
      const created = await airtableReq("POST", url, { fields });
      return json(200, { ok: true, record: created });
    }

    // PATCH /tasks/:recordId
    if (event.httpMethod === "PATCH" && subpath.startsWith("tasks/")) {
      const recordId = subpath.split("/")[1];
      if (!recordId) return json(400, { ok: false, error: "Missing recordId" });

      const payload = JSON.parse(event.body || "{}");
      const fields = {};
      if (payload.name !== undefined) fields["Name"] = payload.name;
      if (payload.description !== undefined) fields["Description"] = payload.description;
      if (payload.owner !== undefined) fields["Owner"] = payload.owner;
      if (payload.status !== undefined) fields["Status"] = payload.status;
      if (payload.progress !== undefined) fields["Progress"] = Number(payload.progress ?? 0);
      if (payload.startDate !== undefined) fields["Start Date"] = payload.startDate || null;
      if (payload.endDate !== undefined) fields["End Date"] = payload.endDate || null;

      if (payload.projectKey) {
        const { projectKeyToId } = await buildProjectMaps();
        const projectRecordId = projectKeyToId[payload.projectKey];
        if (!projectRecordId) throw new Error(`Unknown projectKey: ${payload.projectKey}`);
        fields["Project"] = [projectRecordId];
      }

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_TASKS)}/${recordId}`;
      const updated = await airtableReq("PATCH", url, { fields });
      return json(200, { ok: true, record: updated });
    }

    // DELETE /tasks/:recordId
    if (event.httpMethod === "DELETE" && subpath.startsWith("tasks/")) {
      const recordId = subpath.split("/")[1];
      if (!recordId) return json(400, { ok: false, error: "Missing recordId" });

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_TASKS)}/${recordId}`;
      const deleted = await airtableReq("DELETE", url);
      return json(200, { ok: true, deleted });
    }

    // ==========================
    // CASHFLOW CRUD
    // ==========================
    if (event.httpMethod === "POST" && subpath === "cashflow") {
      const payload = JSON.parse(event.body || "{}");
      const { projectKey } = payload;
      if (!projectKey) return json(400, { ok: false, error: "Missing projectKey" });

      const { projectKeyToId } = await buildProjectMaps();
      const projectRecordId = projectKeyToId[projectKey];
      if (!projectRecordId) return json(400, { ok: false, error: `Unknown projectKey: ${projectKey}` });

      const fields = {
        "Project": [projectRecordId],
        "Type": payload.type || "out",
        "Concept": payload.concept || "",
        "Party": payload.party || "",
        "Amount": Number(payload.amount ?? 0),
        ...(payload.date ? { "Date": payload.date } : {}),
        ...(payload.status ? { "Status": payload.status } : {}),
      };

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CASHFLOW)}`;
      const created = await airtableReq("POST", url, { fields });
      return json(200, { ok: true, record: created });
    }

    if (event.httpMethod === "PATCH" && subpath.startsWith("cashflow/")) {
      const recordId = subpath.split("/")[1];
      if (!recordId) return json(400, { ok: false, error: "Missing recordId" });

      const payload = JSON.parse(event.body || "{}");
      const fields = {};
      if (payload.type !== undefined) fields["Type"] = payload.type || null;
      if (payload.concept !== undefined) fields["Concept"] = payload.concept || "";
      if (payload.party !== undefined) fields["Party"] = payload.party || "";
      if (payload.amount !== undefined) fields["Amount"] = Number(payload.amount ?? 0);
      if (payload.date !== undefined) fields["Date"] = payload.date || null;
      if (payload.status !== undefined) fields["Status"] = payload.status || null;

      if (payload.projectKey) {
        const { projectKeyToId } = await buildProjectMaps();
        const projectRecordId = projectKeyToId[payload.projectKey];
        if (!projectRecordId) throw new Error(`Unknown projectKey: ${payload.projectKey}`);
        fields["Project"] = [projectRecordId];
      }

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CASHFLOW)}/${recordId}`;
      const updated = await airtableReq("PATCH", url, { fields });
      return json(200, { ok: true, record: updated });
    }

    if (event.httpMethod === "DELETE" && subpath.startsWith("cashflow/")) {
      const recordId = subpath.split("/")[1];
      if (!recordId) return json(400, { ok: false, error: "Missing recordId" });

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CASHFLOW)}/${recordId}`;
      const deleted = await airtableReq("DELETE", url);
      return json(200, { ok: true, deleted });
    }

    return json(404, { ok: false, error: "Not found" });
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: String(e) }),
    };
  }
};

