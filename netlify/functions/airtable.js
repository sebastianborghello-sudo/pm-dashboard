// netlify/functions/airtable.js
exports.handler = async (event) => {
  const json = (statusCode, bodyObj, extraHeaders = {}) => ({
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(bodyObj),
  });

  try {
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TOKEN = process.env.AIRTABLE_TOKEN;

    const TABLE_PROJECTS = "Projects";
    const TABLE_TASKS = "Tasks";
    const TABLE_TEAM = "Team";
    const TABLE_CRITICAL = "Critical";
    const TABLE_CASHFLOW = "Cashflow";

    // CORS / preflight
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

    if (!BASE_ID || !TOKEN) {
      return json(500, {
        ok: false,
        error: "Missing env vars AIRTABLE_BASE_ID / AIRTABLE_TOKEN",
      });
    }

    const baseApi = (table) =>
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;

    const listApi = (table) => `${baseApi(table)}?pageSize=100`;

    async function fetchAll(table) {
      let out = [];
      let offset = null;

      while (true) {
        const url = offset ? `${listApi(table)}&offset=${offset}` : listApi(table);
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        });

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

    // Helper: construir mapas projectKey <-> projectRecordId
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
    const subpath = rest.replace(/^\/+/, ""); // "", "tasks", "tasks/recxxx", "cashflow", ...

    // ==========================
    // GET /airtable  -> {projects: {...}}
    // ==========================
    if (event.httpMethod === "GET" && (subpath === "" || subpath === "projects")) {
      const { projectsRec, projectIdToKey } = await buildProjectMaps();

      const [tasksRec, teamRec, criticalRec, cashflowRec] = await Promise.all([
        fetchAll(TABLE_TASKS),
        fetchAll(TABLE_TEAM),
        fetchAll(TABLE_CRITICAL),
        fetchAll(TABLE_CASHFLOW),
      ]);

      const projects = {};

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
            ganttStart: pf["Gantt Start"]
              ? new Date(pf["Gantt Start"]).toISOString().slice(0, 10)
              : null,
            ganttEnd: pf["Gantt End"]
              ? new Date(pf["Gantt End"]).toISOString().slice(0, 10)
              : null,
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
          startDate: tf["Start Date"]
            ? new Date(tf["Start Date"]).toISOString().slice(0, 10)
            : "",
          endDate: tf["End Date"]
            ? new Date(tf["End Date"]).toISOString().slice(0, 10)
            : "",
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
      for (const c of cashflowRec) {
        const cf = c.fields || {};
        const proj = cf["Project"];
        const linkedId = Array.isArray(proj) ? proj[0] : proj;
        const projectKey = projectIdToKey[linkedId] || linkedId;
        if (!projectKey || !projects[projectKey]) continue;

        const amount =
          Number(String(cf["Amount"] ?? 0).replace(/[^0-9.-]/g, "")) || 0;

        projects[projectKey].cashflow.push({
          recordId: c.id,
          concept: cf["Concept"] || "",
          date: cf["Date"] ? new Date(cf["Date"]).toISOString().slice(0, 10) : "",
          type: cf["Type"] || "",
          amount,
          currency: cf["Currency"] || "USD",
          party: cf["Party"] || "",
          status: cf["Status"] || "",
          notes: cf["Notes"] || "",
          relatedTask: cf["Relacionado a tarea"] || "",
        });
      }

      return json(200, { ok: true, projects });
    }

    // ==========================
    // POST /tasks
    // ==========================
    if (event.httpMethod === "POST" && subpath === "tasks") {
      const payload = JSON.parse(event.body || "{}");
      const { projectKey } = payload;

      if (!projectKey) return json(400, { ok: false, error: "Missing projectKey" });

      const { projectKeyToId } = await buildProjectMaps();
      const projectRecordId = projectKeyToId[projectKey];
      if (!projectRecordId) {
        return json(400, { ok: false, error: `Unknown projectKey: ${projectKey}` });
      }

      const fields = {
        Project: [projectRecordId],
        Name: payload.name || "",
        Description: payload.description || "",
        Owner: payload.owner || "",
        Status: payload.status || "pending",
        Progress: Number(payload.progress ?? 0),
        ...(payload.startDate ? { "Start Date": payload.startDate } : {}),
        ...(payload.endDate ? { "End Date": payload.endDate } : {}),
      };

      const created = await airtableReq("POST", baseApi(TABLE_TASKS), { fields });
      return json(200, { ok: true, record: created });
    }

    // ==========================
    // PATCH /tasks/:recordId
    // ==========================
    if (event.httpMethod === "PATCH" && subpath.startsWith("tasks/")) {
      const recordId = subpath.split("/")[1];
      if (!recordId) return json(400, { ok: false, error: "Missing recordId" });

      const payload = JSON.parse(event.body || "{}");
      const fields = {};

      if (payload.name !== undefined) fields["Name"] = payload.name || "";
      if (payload.description !== undefined) fields["Description"] = payload.description || "";
      if (payload.owner !== undefined) fields["Owner"] = payload.owner || "";
      if (payload.status !== undefined) fields["Status"] = payload.status || "pending";
      if (payload.progress !== undefined) fields["Progress"] = Number(payload.progress ?? 0);
      if (payload.startDate !== undefined) fields["Start Date"] = payload.startDate || null;
      if (payload.endDate !== undefined) fields["End Date"] = payload.endDate || null;

      if (payload.projectKey) {
        const { projectKeyToId } = await buildProjectMaps();
        const projectRecordId = projectKeyToId[payload.projectKey];
        if (!projectRecordId) throw new Error(`Unknown projectKey: ${payload.projectKey}`);
        fields["Project"] = [projectRecordId];
      }

      const updated = await airtableReq(
        "PATCH",
        `${baseApi(TABLE_TASKS)}/${recordId}`,
        { fields }
      );
      return json(200, { ok: true, record: updated });
    }

    // ==========================
    // POST /cashflow
    // ==========================
    if (event.httpMethod === "POST" && subpath === "cashflow") {
      const payload = JSON.parse(event.body || "{}");
      const { projectKey } = payload;

      if (!projectKey) return json(400, { ok: false, error: "Missing projectKey" });

      const { projectKeyToId } = await buildProjectMaps();
      const projectRecordId = projectKeyToId[projectKey];
      if (!projectRecordId) {
        return json(400, { ok: false, error: `Unknown projectKey: ${projectKey}` });
      }

      const fields = {
        Project: [projectRecordId],
        Concept: payload.concept || "",
        ...(payload.date ? { Date: payload.date } : {}),
        Type: payload.type || "",
        Amount: Number(payload.amount ?? 0),
        Currency: payload.currency || "USD",
        Party: payload.party || "",
        Status: payload.status || "",
        Notes: payload.notes || "",
        "Relacionado a tarea": payload.relatedTask || "",
      };

      const created = await airtableReq("POST", baseApi(TABLE_CASHFLOW), { fields });
      return json(200, { ok: true, record: created });
    }

    // ==========================
    // PATCH /cashflow/:recordId
    // ==========================
    if (event.httpMethod === "PATCH" && subpath.startsWith("cashflow/")) {
      const recordId = subpath.split("/")[1];
      if (!recordId) return json(400, { ok: false, error: "Missing recordId" });

      const payload = JSON.parse(event.body || "{}");
      const fields = {};

      if (payload.concept !== undefined) fields["Concept"] = payload.concept || "";
      if (payload.date !== undefined) fields["Date"] = payload.date || null;
      if (payload.type !== undefined) fields["Type"] = payload.type || "";
      if (payload.amount !== undefined) fields["Amount"] = Number(payload.amount ?? 0);
      if (payload.currency !== undefined) fields["Currency"] = payload.currency || "USD";
      if (payload.party !== undefined) fields["Party"] = payload.party || "";
      if (payload.status !== undefined) fields["Status"] = payload.status || "";
      if (payload.notes !== undefined) fields["Notes"] = payload.notes || "";
      if (payload.relatedTask !== undefined) fields["Relacionado a tarea"] = payload.relatedTask || "";

      if (payload.projectKey) {
        const { projectKeyToId } = await buildProjectMaps();
        const projectRecordId = projectKeyToId[payload.projectKey];
        if (!projectRecordId) throw new Error(`Unknown projectKey: ${payload.projectKey}`);
        fields["Project"] = [projectRecordId];
      }

      const updated = await airtableReq(
        "PATCH",
        `${baseApi(TABLE_CASHFLOW)}/${recordId}`,
        { fields }
      );
      return json(200, { ok: true, record: updated });
    }

    // ==========================
    // DELETE /cashflow/:recordId
    // ==========================
    if (event.httpMethod === "DELETE" && subpath.startsWith("cashflow/")) {
      const recordId = subpath.split("/")[1];
      if (!recordId) return json(400, { ok: false, error: "Missing recordId" });

      const deleted = await airtableReq("DELETE", `${baseApi(TABLE_CASHFLOW)}/${recordId}`);
      return json(200, { ok: true, deleted });
    }

    return json(404, { ok: false, error: "Not found" });
  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: false, error: String(e) }),
    };
  }
};
