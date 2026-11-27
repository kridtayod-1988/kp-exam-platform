(() => {
  const config = window.KP_CONFIG || {};
  const apiBase = String(config.apiBaseUrl || "").replace(/\/$/, "");
  const action = document.getElementById("auth-action");
  const nameNode = document.getElementById("user-name");
  const planNode = document.getElementById("user-plan");
  const avatarNode = document.querySelector(".user-profile .avatar");

  if (!action || !nameNode || !planNode || !avatarNode) return;

  let csrfToken = "";
  let authenticated = false;
  let currentProfile = null;

  function notifyAuthState() {
    window.dispatchEvent(new CustomEvent("kp-auth-state", {
      detail: { authenticated, profile: currentProfile }
    }));
  }

  function renderGuest() {
    authenticated = false;
    currentProfile = null;
    csrfToken = "";
    nameNode.textContent = "ผู้เยี่ยมชม";
    planNode.textContent = "Guest · ยังไม่ได้เข้าสู่ระบบ";
    avatarNode.textContent = "G";
    action.hidden = false;
    action.textContent = "เข้าสู่ระบบ";
    action.setAttribute("aria-label", "เข้าสู่ระบบด้วย Google");
    notifyAuthState();
  }

  function renderProfile(profile) {
    authenticated = true;
    currentProfile = profile;
    nameNode.textContent = profile.display_name || profile.email || "สมาชิก";
    planNode.textContent = profile.role === "admin" ? "Admin · เข้าสู่ระบบแล้ว" : "User · เข้าสู่ระบบแล้ว";
    avatarNode.textContent = String(profile.display_name || profile.email || "U").trim().charAt(0).toUpperCase() || "U";
    action.hidden = false;
    action.textContent = "ออกจากระบบ";
    action.setAttribute("aria-label", "ออกจากระบบ");
    notifyAuthState();
  }

  async function loadSession() {
    if (config.authEnabled !== true || !apiBase) {
      action.hidden = true;
      return;
    }

    action.hidden = false;
    action.disabled = true;
    action.textContent = "กำลังตรวจสอบ…";
    try {
      const response = await fetch(apiBase + "/api/auth/session", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        renderGuest();
        return;
      }
      const payload = await response.json();
      if (!payload.authenticated || !payload.profile || !payload.csrf_token) {
        renderGuest();
        return;
      }
      csrfToken = payload.csrf_token;
      renderProfile(payload.profile);
    } catch {
      renderGuest();
      action.textContent = "เข้าสู่ระบบ";
    } finally {
      action.disabled = false;
    }
  }

  async function logout() {
    action.disabled = true;
    action.textContent = "กำลังออกจากระบบ…";
    try {
      const response = await fetch(apiBase + "/api/auth/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": csrfToken
        }
      });
      if (!response.ok) throw new Error("LOGOUT_FAILED");
      renderGuest();
    } catch {
      action.textContent = "ลองออกจากระบบอีกครั้ง";
    } finally {
      action.disabled = false;
    }
  }

  action.addEventListener("click", () => {
    if (!config.authEnabled || !apiBase) return;
    if (authenticated) {
      void logout();
      return;
    }
    window.location.assign(apiBase + "/auth/google/start");
  });

  window.KP_AUTH = {
    get authenticated() { return authenticated; },
    get profile() { return currentProfile; },
    get csrfToken() { return csrfToken; },
    refresh: loadSession
  };

  void loadSession();
})();
