exports.handler = async (event, context) => {
  const user = context?.clientContext?.user || null;

  if (!user) {
    return {
      statusCode: 302,
      headers: {
        Location: "/login.html",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: `
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="refresh" content="0; url=/" />
        <script>window.location.href='/'</script>
      </head>
      <body></body>
      </html>
    `,
  };
};
