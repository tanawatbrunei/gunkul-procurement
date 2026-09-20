import VendorPage from "./VendorPage";
import TrackingPage from "./TrackingPage";
import { useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth } from "./firebase";
import DashboardPage from "./Dashboard";
import KnowledgePage from "./KnowledgePage";
import ESGPage from "./ESGPage";
import OrgChartPage from "./OrgChartPage";
import LoginPage from "./LoginPage";
import HomePage from "./HomePage";
import ProjectPage from "./ProjectPage";
import ItemMasterPage from "./ItemMasterPage";
import Sidebar from "./Sidebar";
import type { Page } from "./Sidebar";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // Keep every page a user has opened mounted (hidden when inactive) instead of
  // unmounting it. Each page's Firestore listener then reads its collection ONCE
  // per session on first visit, rather than re-reading it on every navigation —
  // a big cut in Firestore reads for a team that hops between pages all day.
  const [visited, setVisited] = useState<Set<Page>>(() => new Set<Page>(["home"]));
  const navigate = (p: Page) => {
    setVisited((v) => (v.has(p) ? v : new Set(v).add(p)));
    setCurrentPage(p);
  };
  // Item Master → "open this vendor": remember which vendor, then switch pages.
  // `n` makes repeat clicks on the same vendor register as a new request.
  const [vendorToOpen, setVendorToOpen] = useState<{ code: string; n: number } | null>(null);
  const openVendor = (code: string) => {
    setVendorToOpen({ code, n: Date.now() });
    navigate("vendor");
  };
  const pageStyle = (p: Page) => ({ display: currentPage === p ? "block" : "none" } as const);

  useState(() => {
    onAuthStateChanged(auth, (user) => {
      if (user) { setCurrentUser(user); setLoggedIn(true); }
      else { setCurrentUser(null); setLoggedIn(false); }
    });
  });

  if (!loggedIn) {
    return <LoginPage onLogin={() => setLoggedIn(true)} />;
  }

  const userLabel = currentUser?.email?.split("@")[0] ?? "";

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      <Sidebar
        currentPage={currentPage}
        onNavigate={navigate}
        userLabel={userLabel}
        onLogout={() => setLoggedIn(false)}
      />
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1 }}>
          {visited.has("home") && <div style={pageStyle("home")}><HomePage setPage={navigate} /></div>}
          {visited.has("dashboard") && <div style={pageStyle("dashboard")}><DashboardPage /></div>}
          {visited.has("project") && <div style={pageStyle("project")}><ProjectPage /></div>}
          {visited.has("vendor") && <div style={pageStyle("vendor")}><VendorPage openVendor={vendorToOpen} /></div>}
          {visited.has("itemmaster") && <div style={pageStyle("itemmaster")}><ItemMasterPage onOpenVendor={openVendor} /></div>}
          {visited.has("tracking") && <div style={pageStyle("tracking")}><TrackingPage /></div>}
          {visited.has("team") && <div style={pageStyle("team")}><OrgChartPage /></div>}
          {visited.has("knowledge") && <div style={pageStyle("knowledge")}><KnowledgePage /></div>}
          {visited.has("esg") && <div style={pageStyle("esg")}><ESGPage /></div>}
        </div>
        <footer
          style={{
            textAlign: "center",
            padding: "var(--sp-4)",
            fontSize: "var(--fs-xs)",
            color: "var(--text-faint)",
            borderTop: "1px solid var(--border)",
          }}
        >
          © {new Date().getFullYear()} Gunkul Engineering Public Company Limited. All rights reserved.
        </footer>
      </main>
    </div>
  );
}