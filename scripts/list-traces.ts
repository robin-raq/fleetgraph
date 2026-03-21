async function main() {
  // Try listing projects to understand API access
  const resp = await fetch("https://api.smith.langchain.com/info", {
    headers: { "x-api-key": process.env.LANGCHAIN_API_KEY! }
  });
  console.log("Info status:", resp.status);
  const body = await resp.text();
  console.log("Body:", body.slice(0, 500));

  // Try the sessions endpoint without filter
  const sessResp = await fetch("https://api.smith.langchain.com/sessions", {
    headers: { "x-api-key": process.env.LANGCHAIN_API_KEY! }
  });
  console.log("\nSessions status:", sessResp.status);
  const sessBody = await sessResp.text();
  console.log("Sessions:", sessBody.slice(0, 500));
}
main().catch(console.error);
