// netlify/functions/airtable.js
exports.handler = async (event) => {
  try {
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TOKEN = process.env.AIRTABLE_TOKEN; // tu env var actual

    const TABLE_PROJECTS = "Projects";
    const TABLE_TASKS = "Tasks";
    const TABLE_TEAM = "Team";
    const TABLE_CRITICAL = "Critical";

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing env vars AIRTABLE_BASE_ID / AIRTABLE_TOKEN" }),
      };
    }

    const api = (table) =>
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?pageSize=100`;

    async function fetchAll(table) {
      let out = [];
      let offset = null;

      while (true) {
        const url = offset ? `${api(table)}&offset=${offset}` : api(table);
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
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

      if (!r.ok) {
        throw new Error(`Airtable write error: ${r.status} ${JSON.stringify(data)}`);
      }
      return data;
    }

    // Helper: construir mapas projectKey <-> projectRecordId
    async function buildProjectMaps() {
      const projectsRec = await fetchAll(TABLE_PROJECTS);

      const projectIdToKey = {};   // recId -> "macro_lan"
      const projectKeyToId = {};   // "macro_lan" -> recId

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
    const subpath = rest.replace(/^\/+/, ""); // "", "tasks", "tasks/recXXXX"

    // ==========================
    // GET (tu comportamiento)
    // ==========================
    if (event.httpMethod === "GET" && (subpath === "" || subpath === "projects")) {
      const { projectsRec, projectIdToKey } = await buildProjectMaps();

      const [tasksRec, teamRec, criticalRec] = await Promise.all([
        fetchAll(TABLE_TASKS),
        fetchAll(TABLE_TEAM),
        fetchAll(TABLE_CRITICAL),
      ]);

      const projects = {};

      // Projects: Primary field = Project Key ✅
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
        };
      }

      // Tasks: agregamos recordId (t.id) para poder PATCH/DELETE desde el dashboard ✅
      for (const t of tasksRec) {
        const tf = t.fields || {};
        const proj = tf["Project"];
        const linkedId = Array.isArray(proj) ? proj[0] : proj;
        const projectKey = projectIdToKey[linkedId] || linkedId;
        if (!projectKey || !projects[projectKey]) continue;

        projects[projectKey].tasks.push({
          recordId: t.id, // ✅ clave para updates
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

      for (const c of criticalRec) {
        const cf = c.fields || {};
        const proj = cf["Project"];
        const linkedId = Array.isArray(proj) ? proj[0] : proj;
        const projectKey = projectIdToKey[linkedId] || linkedId;
        if (!projectKey || !projects[projectKey]) continue;

        projects[projectKey].critical.push(cf["Text"] || "");
      }

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ projects }),
      };
    }

    // ==========================
    // POST /tasks  (crear task)
    // Body esperado:
    // {
    //   projectKey: "macro_lan",
    //   name, description, owner, status, progress, startDate, endDate
    // }
    // ==========================
    if (event.httpMethod === "POST" && subpath === "tasks") {
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
        // Linked record: Airtable API espera recordId(s)
        "Project": [projectRecordId],

        "Name": payload.name || "",
        "Description": payload.description || "",
        "Owner": payload.owner || "",
        "Status": payload.status || "pending",
        "Progress": Number(payload.progress ?? 0),

        // Dates: pasamos ISO YYYY-MM-DD
        ...(payload.startDate ? { "Start Date": payload.startDate } : {}),
        ...(payload.endDate ? { "End Date": payload.endDate } : {}),
      };

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_TASKS)}`;
      const created = await airtableReq("POST", url, { fields });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, record: created }),
      };
    }

    // ==========================
    // PATCH /tasks/:recordId  (actualizar task)
    // ==========================
    if (event.httpMethod === "PATCH" && subpath.startsWith("tasks/")) {
      const recordId = subpath.split("/")[1];
      if (!recordId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ ok: false, error: "Missing recordId" }),
        };
      }

      const payload = JSON.parse(event.body || "{}");

      const fields = {};
      if (payload.name !== undefined) fields["Name"] = payload.name;
      if (payload.description !== undefined) fields["Description"] = payload.description;
      if (payload.owner !== undefined) fields["Owner"] = payload.owner;
      if (payload.status !== undefined) fields["Status"] = payload.status;
      if (payload.progress !== undefined) fields["Progress"] = Number(payload.progress ?? 0);
      if (payload.startDate !== undefined) fields["Start Date"] = payload.startDate || null;
      if (payload.endDate !== undefined) fields["End Date"] = payload.endDate || null;

      // Si querés permitir mover de proyecto:
      if (payload.projectKey) {
        const { projectKeyToId } = await buildProjectMaps();
        const projectRecordId = projectKeyToId[payload.projectKey];
        if (!projectRecordId) throw new Error(`Unknown projectKey: ${payload.projectKey}`);
        fields["Project"] = [projectRecordId];
      }

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_TASKS)}/${recordId}`;
      const updated = await airtableReq("PATCH", url, { fields });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, record: updated }),
      };
    }

    // ==========================
    // DELETE /tasks/:recordId
    // ==========================
    if (event.httpMethod === "DELETE" && subpath.startsWith("tasks/")) {
      const recordId = subpath.split("/")[1];
      if (!recordId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ ok: false, error: "Missing recordId" }),
        };
      }

      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_TASKS)}/${recordId}`;
      const deleted = await airtableReq("DELETE", url);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, deleted }),
      };
    }

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

