import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";           // your TradingJournalApp
import AuthGate from "./AuthGate"; // the file with the sign in / sign up UI

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <AuthGate>
    {(user) => <App user={user} />}
  </AuthGate>
);
