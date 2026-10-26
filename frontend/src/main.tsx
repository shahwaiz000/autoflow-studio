import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Workflows from "./pages/Workflows";
import Executions from "./pages/Executions";
import Analytics from "./pages/Analytics";
import WorkflowEditor from "./pages/WorkflowEditor";
import Templates from "./pages/Templates";
import WorkflowBuilder from "./pages/WorkflowBuilder";
import Upload from "./pages/Upload";
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
          <Route path="workflows/new" element={<WorkflowEditor />} />
          <Route path="workflows/:id/edit" element={<WorkflowEditor />} />
          <Route path="executions" element={<Executions />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="builder" element={<WorkflowBuilder />} />
          <Route path="builder/:id" element={<WorkflowBuilder />} />
          <Route path="templates" element={<Templates />} />
          <Route path="upload" element={<Upload />} />
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
