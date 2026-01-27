export default async (req) => {
  try {
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TOKEN = process.env.AIRTABLE_TOKEN;

    const TABLE_PROJECTS = "Projects";
    const TABLE_TASKS = "Tasks";
    const TABLE_TEAM = "Team";
    const TABLE_CRITICAL = "Critical";

    if (!BASE_ID || !TOKEN) {
      return new Response(JSON.stringify({ error: "Missing env vars" }), { status: 500 });
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

    const [projectsRec, tasksRec, teamRec, criticalRec] = await Promise.all([
      fetchAll(TABLE_PROJECTS),
      fetchAll(TABLE_TASKS),
      fetchAll(TABLE_TEAM),
      fetchAll(TABLE_CRITICAL),
    ]);

    // Helper: tomar campos con fallback
    const f = (rec) => rec.fields || {};

    // Construir projects{key: {...}}
    const projects = {};

    for (const p of projectsRec) {
      const pf = f(p);
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

    // Tasks: el campo "Project" en Airtable (link) devuelve array de nombres (por default).
    // Nosotros lo haremos matchear contra Project Key. Para eso, en tu base:
    // - Asegurate que el Primary field de Projects sea "Project Key" (ideal),
    //   o que el valor linkeado coincida con el Project Key.
    for (const t of tasksRec) {
      const tf = f(t);
      const proj = tf["Project"];
      const projectKey = Array.isArray(proj) ? proj[0] : proj;

      if (!projectKey || !projects[projectKey]) continue;

      projects[projectKey].tasks.push({
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
      const mf = f(m);
      const proj = mf["Project"];
      const projectKey = Array.isArray(proj) ? proj[0] : proj;

      if (!projectKey || !projects[projectKey]) continue;

      projects[projectKey].team.push({
        name: mf["Name"] || "",
        role: mf["Role"] || "",
        initials: mf["Initials"] || "",
      });
    }

    for (const c of criticalRec) {
      const cf = f(c);
      const proj = cf["Project"];
      const projectKey = Array.isArray(proj) ? proj[0] : proj;

      if (!projectKey || !projects[projectKey]) continue;

      projects[projectKey].critical.push(cf["Text"] || "");
    }

    return new Response(JSON.stringify({ projects }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
};
