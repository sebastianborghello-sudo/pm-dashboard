// netlify/functions/airtable.js

exports.handler = async (event) => {
  try {
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TOKEN = process.env.AIRTABLE_TOKEN;

    const TABLE_PROJECTS = "Projects";
    const TABLE_TASKS = "Tasks";
    const TABLE_TEAM = "Team";
    const TABLE_CRITICAL = "Critical";
    const TABLE_CASHFLOW = "Cashflow"; // <-- asegurate que tu tabla se llame así

    // CORS / preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        },
        body: "",
      };
    }

    if (!BASE_ID || !TOKEN) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
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
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

      if (!r.ok) {
        throw new Error(`Airtable write error: ${r.status} ${JSON.stringify(data)}`);
      }
      return data;
    }

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
    const subpath = rest.replace(/^\/+/, ""); // "", "tasks", "tasks/recXXXX", "cashflow", "cashflow/recXXXX"

    // ==========================
    // GET /  (projects + tasks + team + critical + cashflow)
    // ==========================
    if (event.httpMethod === "GET" && (subpath === "" || subpath === "projects")) {
      const { projectsRec, projectIdToKey } = await buildProjectMaps();

      const [tasksRec, teamRec, criticalRec, cashRec] = await Promise.all([
        fetchAll(TABLE_TASKS),
        fetchAll(TABLE_TEAM),
        fetchAll(TABLE_CRITICAL),
        fetchAll(TABLE_CASHFLOW).catch(() => []), // si la tabla no existe todavía, no rompe
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

      // Cashflow (según tu CSV: Counterparty, etc.)
      for (const r of cashRec) {
        const f = r.fields || {};
        const proj = f["Project"];
        const linkedId = Array.isArray(proj) ? proj[0] : proj;
        const projectKey = projectIdToKey[linkedId] || linkedId;
        if (!projectKey || !projects[projectKey]) continue;

        // Date puede venir como ISO o como texto, intentamos normalizar
        let isoDate = "";
        if (f["Date"]) {
          try {
            isoDate = new Date(f["Date"]).toISOString().slice(0, 10);
          } catch {
            isoDate = String(f["Date"]);
          }
        }

        projects[projectKey].cashflow.push({
          recordId: r.id,
          name: f["Name"] || "",
          date: isoDate,
          type: f["Type"] || "", // Cobro / Pago
          amount: f["Amount"] ?? "",
          currency: f["Currency"] || "",
          counterparty: f["Counterparty"] || "", // <-- tu campo real
          status: f["Status"] || "",
          notes: f["Notes"] || "",
          relatedTask: f["Relacionado a tarea"] || "",
        });
      }

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ ok: true, projects }),
      };
    }

    // ==========================
    // POST /cashflow  (crear movimiento)
    // ==========================
    if (event.httpMethod === "POST" && subpath === "cashflow") {
      const payload = JSON.parse(event.body || "{}");
      const { projectKey } = payload;

      if (!projectKey) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ ok: false, error: "Missing projectKey" }),
        };
      }

      const { projectKeyToId } = await buildProjectMaps();
      const projectRecordId = projectKeyToId[projectKey];
      if (!projectRecordId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ ok: false, error: `Unknown projectKey: ${projectKey}` }),
        };
      }

      const fields = {
        Project: [projectRecordId],
        Name: payload.name || "",
        Type: payload.type || "",
        Amount: payload.amount ?? "",
        Currency: payload.currency || "USD",
        Counterparty: payload.counterparty || "",
        Status: payload.status || "Previsto",
        Notes: payload.notes || "",
        "Relacionado a tarea": payload.relatedTask || "",
        ...(payload.date ? { Date: payload.date } : {}),
      };

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CASHFLOW)}`;
      const created = await airtableReq("POST", url, { fields });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, record: created }),
      };
    }

    // ==========================
    // PATCH /cashflow/:recordId
    // ==========================
    if (event.httpMethod === "PATCH" && subpath.startsWith("cashflow/")) {
      const recordId = subpath.split("/")[1];
      const payload = JSON.parse(event.body || "{}");

      const fields = {};
      if (payload.projectKey) {
        const { projectKeyToId } = await buildProjectMaps();
        const projectRecordId = projectKeyToId[payload.projectKey];
        if (!projectRecordId) throw new Error(`Unknown projectKey: ${payload.projectKey}`);
        fields.Project = [projectRecordId];
      }

      if (payload.name !== undefined) fields.Name = payload.name;
      if (payload.date !== undefined) fields.Date = payload.date || null;
      if (payload.type !== undefined) fields.Type = payload.type;
      if (payload.amount !== undefined) fields.Amount = payload.amount;
      if (payload.currency !== undefined) fields.Currency = payload.currency;
      if (payload.counterparty !== undefined) fields.Counterparty = payload.counterparty;
      if (payload.status !== undefined) fields.Status = payload.status;
      if (payload.notes !== undefined) fields.Notes = payload.notes;
      if (payload.relatedTask !== undefined) fields["Relacionado a tarea"] = payload.relatedTask;

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CASHFLOW)}/${recordId}`;
      const updated = await airtableReq("PATCH", url, { fields });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, record: updated }),
      };
    }

    // ==========================
    // DELETE /cashflow/:recordId
    // ==========================
    if (event.httpMethod === "DELETE" && subpath.startsWith("cashflow/")) {
      const recordId = subpath.split("/")[1];
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_CASHFLOW)}/${recordId}`;
      const deleted = await airtableReq("DELETE", url);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, deleted }),
      };
    }

    // (Tus rutas de TASKS pueden quedarse como estaban en tu versión actual.
    // Si querés, las integro acá también, pero no hace falta para arreglar el 500 del cashflow.)

    return {
      statusCode: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: "Not found" }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: String(e) }),
    };
  }
};
