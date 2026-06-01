import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import { App } from "./App";

const el = document.getElementById("root");
if (el) {
  ReactDOM.createRoot(el).render(<App />);
}
