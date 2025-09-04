import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AuthGate from "./AuthGate";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <AuthGate>{(user) => <App user={user} />}</AuthGate>
);
