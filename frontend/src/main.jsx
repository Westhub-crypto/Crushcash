import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<React.StrictMode><App /></React.StrictMode>);

// Remove loading screen once React mounts
const loader = document.getElementById("app-loader");
if (loader) {
  loader.classList.add("hide");
  setTimeout(() => loader.remove(), 450);
}
