// End-to-end smoke test over real HTTP against a running, seeded stack:
// browser-style calls to the GraphQL BFF and the gRPC service, covering
// CORS preflight, login, checkout, the order stream and access rules.
//
//   Docker stack (default):  npm run smoke
//   Local dev servers:       GQL_URL=http://127.0.0.1:4000/graphql \
//                            GRPC_URL=http://127.0.0.1:50051 npm run smoke
//
// Uses the demo accounts from prisma/seed.ts. Each run buys one item and
// restocks it, so stock levels stay the same.
const GQL = process.env.GQL_URL ?? "http://localhost:3000/graphql";
const GRPC = (process.env.GRPC_URL ?? "http://localhost:3000/grpc") + "/ecommerce.v1.InventoryService";
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

async function gql(query, variables, token) {
  const r = await fetch(GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

async function stream(orderId, token) {
  const json = Buffer.from(JSON.stringify({ orderId }));
  const env = Buffer.alloc(5 + json.length);
  env.writeUInt32BE(json.length, 1);
  json.copy(env, 5);
  const r = await fetch(`${GRPC}/StreamOrderStatus`, {
    method: "POST",
    headers: {
      "Content-Type": "application/connect+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: env,
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const msgs = [];
  let end = null;
  for (let i = 0; i < buf.length; ) {
    const flags = buf[i], len = buf.readUInt32BE(i + 1);
    const payload = JSON.parse(buf.subarray(i + 5, i + 5 + len).toString());
    flags & 2 ? (end = payload) : msgs.push(payload);
    i += 5 + len;
  }
  return { msgs, end };
}

const LOGIN = `mutation($e: String!, $p: String!) { login(email: $e, password: $p) { token user { id email role } } }`;
const CHECKOUT = `mutation($id: ID!) { checkout(productId: $id, quantity: 1) { orderId success message } }`;

// CORS: browsers preflight Authorization headers on both servers.
for (const [name, url] of [["GraphQL", GQL], ["gRPC", `${GRPC}/StreamOrderStatus`]]) {
  const r = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  const allowed = (r.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  check(r.ok && allowed.includes("authorization"), `${name} CORS preflight allows Authorization`);
}

const { data: catalog } = await gql("{ products { id name stock } }");
check(catalog.products.length === 4, "catalog is public (4 products, no token)");
const productId = catalog.products[0].id;

const anon = await gql(CHECKOUT, { id: productId });
check(anon.errors?.[0].extensions.code === "UNAUTHENTICATED", `signed-out checkout rejected: "${anon.errors?.[0].message}"`);
check((await gql("{ me { id } }")).data.me === null, "me is null when signed out");

const bad = await gql(LOGIN, { e: "customer@example.com", p: "wrong-password" });
check(bad.errors?.[0].message === "Invalid email or password", "wrong password rejected");

const login = await gql(LOGIN, { e: "customer@example.com", p: "customer-dev-password" });
const token = login.data?.login.token;
check(!!token && login.data.login.user.role === "CUSTOMER", "seeded customer can log in");
check((await gql("{ me { email } }", {}, token)).data.me.email === "customer@example.com", "me returns the customer with the token");

const order = (await gql(CHECKOUT, { id: productId }, token)).data.checkout;
check(order.success, `signed-in checkout succeeds (${order.orderId})`);

const own = await stream(order.orderId, token);
check(own.msgs.at(-1)?.status === "DELIVERED", `owner can stream their order (${own.msgs.length} updates)`);
check((await stream(order.orderId)).end?.error?.code === "unauthenticated", "stream without token -> unauthenticated");

const email = `e2e-${Date.now()}@example.com`;
const reg = await gql(`mutation($e: String!) { register(email: $e, password: "e2e-password") { token } }`, { e: email });
const otherToken = reg.data?.register.token;
check(!!otherToken, "new user can register");
check((await stream(order.orderId, otherToken)).end?.error?.code === "not_found", "another user can't stream it (not_found)");

const adminLogin = await gql(LOGIN, { e: "admin@example.com", p: "admin-dev-password" });
const adminToken = adminLogin.data?.login.token;
check(adminLogin.data?.login.user.role === "ADMIN", "seeded admin can log in");
check((await stream(order.orderId, adminToken)).msgs.length === 1, "admin can stream any order");

const restock = async (t) =>
  (await fetch(`${GRPC}/UpdateStock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify({ productId, quantityChange: 1 }),
  })).json();
check((await restock(token)).code === "permission_denied", "customer can't restock (permission_denied)");
check((await restock(adminToken)).success === true, "admin can restock");

const dup = await gql(`mutation($e: String!) { register(email: $e, password: "e2e-password") { token } }`, { e: email.toUpperCase() });
check(dup.errors?.[0].extensions.code === "BAD_USER_INPUT", `duplicate email rejected: "${dup.errors?.[0].message}"`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exitCode = failures ? 1 : 0;
