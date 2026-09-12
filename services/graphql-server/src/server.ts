import express from "express";
import { createYoga } from "graphql-yoga";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { typeDefs, resolvers } from "./schema.js";

const app = express();
const PORT = 4000;

// Create executable GraphQL Schema
const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

// Initialize GraphQL Yoga server
const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  landingPage: true, // Enables interactive GraphiQL IDE in browser
});

// Bind Yoga middleware to Express
app.use(yoga.graphqlEndpoint, yoga);

app.listen(PORT, () => {
  console.log(
    `🌐 GraphQL BFF Server is running on http://localhost:${PORT}/graphql`,
  );
  console.log(
    `💡 Open http://localhost:${PORT}/graphql in your browser to try GraphiQL IDE!`,
  );
});
