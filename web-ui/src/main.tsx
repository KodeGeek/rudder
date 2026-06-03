import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import { App } from "./App";
import { DataProvider } from "./lib/data";
import { AuthGate } from "./screens/Login";

const el = document.getElementById("root");
if (el) {
  ReactDOM.createRoot(el).render(
    <AuthGate>
      <DataProvider>
        <App />
      </DataProvider>
    </AuthGate>
  );
}
