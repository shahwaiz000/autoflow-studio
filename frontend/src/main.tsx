import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Workflows from "./pages/Workflows";
import Executions from "./pages/Executions";
import Templates from "./pages/Templates";
import WorkflowBuilder from "./pages/WorkflowBuilder";
import ExecutionDetail from "./pages/ExecutionDetail";
import Assistant from "./pages/Assistant";
import Schedules from "./pages/Schedules";
import DataSources from "./pages/DataSources";
import Account from "./pages/Account";
import { AuthGate } from "./auth";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="workflows" element={<Workflows />} />
          <Route path="executions" element={<Executions />} />
          <Route path="builder" element={<WorkflowBuilder />} />
          <Route path="builder/:id" element={<WorkflowBuilder />} />
          <Route path="templates" element={<Templates />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="schedules" element={<Schedules />} />
          <Route path="data-sources" element={<DataSources />} />
          <Route path="account" element={<Account />} />
          <Route path="executions/:id" element={<ExecutionDetail />} />
        </Route>
      </Routes>
      </AuthGate>
    </BrowserRouter>
  </React.StrictMode>,
);
