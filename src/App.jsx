import { useEffect, useRef, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { marked } from "marked";
import {
  createComment,
  deleteComment,
  entityKey,
  fetchEngagementStats,
  formatCount,
  getEntityStats,
  incrementView,
  parseLooseCount,
  toggleLike,
} from "./lib/engagementApi";
import {
  loadProjectDocumentation,
  loadProjectsFromJson,
  loadRepoFile,
  loadRepoProject,
  parseGithubUrl,
  repoSlug,
  rewriteReadmeAssets,
} from "./lib/projectApi";
import { fetchAccountProfile, saveAccountProfile } from "./lib/accountApi";
import {
  clearPendingRequestedRole,
  getAuthRedirectUrl,
  getPendingRequestedRole,
  getSupabaseClient,
  loadSupabaseRuntimeConfig,
  resolveSupabasePublishableKey,
  resolveSupabaseUrl,
  setPendingRequestedRole,
} from "./lib/supabaseClient";

function fixText(value) {
  if (typeof value !== "string" || !/[ÂÃâð]/.test(value)) {
    return value;
  }

  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}

function normalizeData(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeData);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeData(item)])
    );
  }

  return fixText(value);
}

function markdownToHtml(markdown) {
  return marked.parse(fixText(markdown || ""));
}

function useJson(url) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load ${url}`);
        }

        const json = await response.json();
        if (active) {
          setState({ data: normalizeData(json), error: null, loading: false });
        }
      } catch (error) {
        if (active) {
          setState({ data: null, error, loading: false });
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [url]);

  return state;
}

function useText(url) {
  const [state, setState] = useState({ data: "", error: null, loading: true });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load ${url}`);
        }

        const text = await response.text();
        if (active) {
          setState({ data: fixText(text), error: null, loading: false });
        }
      } catch (error) {
        if (active) {
          setState({ data: "", error, loading: false });
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [url]);

  return state;
}

function usePageSetup(title, bodyClassName = "") {
  const location = useLocation();

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.body.className = bodyClassName ? `${bodyClassName} page-ready` : "page-ready";
  }, [bodyClassName, location.pathname, location.search]);
}

function useTransitionNavigate() {
  const navigate = useNavigate();

  return (to) => {
    document.body.classList.remove("menu-open");
    document.body.classList.remove("page-ready");
    document.body.classList.add("page-leaving");

    window.setTimeout(() => {
      navigate(to);
    }, 350);
  };
}

function buildWritingRoute(blogId) {
  return `/writings/${encodeURIComponent(blogId)}`;
}

function buildProjectRoute(repo) {
  const [owner, name] = String(repo || "").split("/");
  if (!owner || !name) {
    return "/project";
  }

  return `/project/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function normalizeAuthError(error, context = {}) {
  const fallback = "We couldn't complete authentication. Please try again.";
  const sourceMessage = String(
    error?.message ||
      error?.error_description ||
      error?.description ||
      error?.error ||
      ""
  ).trim();
  const raw = sourceMessage.toLowerCase();

  if (!sourceMessage) {
    return fallback;
  }

  if (raw.includes("invalid login credentials")) {
    return "That email or password did not match. Please check your details and try again.";
  }

  if (raw.includes("email not confirmed")) {
    return "Your email is not confirmed yet. Open the confirmation link from your inbox, then sign in again.";
  }

  if (raw.includes("password should be at least")) {
    return "Use a stronger password with at least 8 characters.";
  }

  if (raw.includes("user already registered")) {
    return "An account with this email already exists. Try logging in instead.";
  }

  if (raw.includes("signup is disabled")) {
    return "New account creation is disabled right now.";
  }

  if (raw.includes("provider is not enabled")) {
    return `The ${context.provider || "selected"} sign-in option is not enabled yet.`;
  }

  if (raw.includes("unsupported provider")) {
    return `The ${context.provider || "selected"} sign-in option is not supported yet.`;
  }

  if (raw.includes("access_denied")) {
    return `Access was denied by ${context.provider || "the provider"}. If this is Google, add your email as a test user or publish the OAuth consent screen first.`;
  }

  if (raw.includes("oauth") && raw.includes("redirect")) {
    return "The sign-in callback URL does not match your provider setup. Check the Supabase redirect URLs and provider callback settings.";
  }

  if (raw.includes("code verifier") || raw.includes("code challenge")) {
    return "This sign-in attempt expired before it finished. Please start the sign-in flow again.";
  }

  if (raw.includes("failed to fetch") || raw.includes("networkerror")) {
    return "A network issue interrupted sign-in. Check your connection and try again.";
  }

  return sourceMessage;
}

function getAuthCallbackErrorFromUrl() {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const searchParams = url.searchParams;
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const errorCode = searchParams.get("error") || hashParams.get("error") || "";
  const errorDescription =
    searchParams.get("error_description") ||
    hashParams.get("error_description") ||
    searchParams.get("error_code") ||
    "";

  if (!errorCode && !errorDescription) {
    return null;
  }

  return {
    error: errorCode,
    error_description: errorDescription,
  };
}

function clearAuthCallbackArtifacts() {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const authKeys = [
    "code",
    "error",
    "error_code",
    "error_description",
    "provider_token",
    "provider_refresh_token",
    "refresh_token",
    "access_token",
    "token_type",
    "type",
  ];

  authKeys.forEach((key) => {
    url.searchParams.delete(key);
  });

  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    authKeys.forEach((key) => {
      hashParams.delete(key);
    });
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : "";
  }

  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function useSupabaseAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [promptMessage, setPromptMessage] = useState("");
  const [callbackReady, setCallbackReady] = useState(false);
  const [configured, setConfigured] = useState(
    Boolean(resolveSupabaseUrl() && resolveSupabasePublishableKey())
  );

  useEffect(() => {
    let active = true;
    let subscription;

    async function initialize() {
      try {
        try {
          await loadSupabaseRuntimeConfig();
        } catch (configError) {
          console.warn("[auth-ui] runtime config load failed", configError);
        }

        const hasConfig = Boolean(resolveSupabaseUrl() && resolveSupabasePublishableKey());
        if (!active) {
          return;
        }

        setConfigured(hasConfig);

        if (!hasConfig) {
          setSession(null);
          setProfile(null);
          setLoading(false);
          setCallbackReady(true);
          return;
        }

        const supabase = getSupabaseClient();
        const callbackError = getAuthCallbackErrorFromUrl();
        if (callbackError && active) {
          setError(normalizeAuthError(callbackError));
          clearPendingRequestedRole();
          clearAuthCallbackArtifacts();
        }

        const authSubscription = supabase.auth.onAuthStateChange(async (event, nextSession) => {
          console.log("[auth-ui] state change", { event });
          setSession(nextSession);

          if (!nextSession?.user) {
            setProfile(null);
            if (event === "SIGNED_OUT") {
              setNotice("You have been signed out.");
            }
            return;
          }

          try {
            const nextProfile = await syncProfile(nextSession.user);
            if (active) {
              setProfile(nextProfile);
              if (event === "SIGNED_IN") {
                setNotice("You are now signed in.");
                clearPendingRequestedRole();
              }
            }
          } catch (profileError) {
            if (active) {
              setError(normalizeAuthError(profileError));
            }
          }
        });
        subscription = authSubscription.data.subscription;

        const url = new URL(window.location.href);
        if (url.pathname === "/auth/callback" && url.searchParams.get("code")) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(url.href);
          if (exchangeError) {
            throw exchangeError;
          }
          if (active) {
            clearAuthCallbackArtifacts();
          }
        }

        const {
          data: { session: initialSession },
        } = await supabase.auth.getSession();

        if (!active) {
          return;
        }

        setSession(initialSession);
        if (initialSession?.user) {
          const nextProfile = await syncProfile(initialSession.user);
          if (active) {
            setProfile(nextProfile);
          }
        } else {
          setProfile(null);
        }
      } catch (authError) {
        if (active) {
          setError(normalizeAuthError(authError));
        }
      } finally {
        if (active) {
          setLoading(false);
          setCallbackReady(true);
        }
      }
    }

    initialize();

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  async function syncProfile(user, overrides = {}) {
    const requestedRole = overrides.requestedRole || getPendingRequestedRole() || user?.user_metadata?.requested_role || "visitor";
    const displayName =
      overrides.displayName ||
      user?.user_metadata?.display_name ||
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      (user?.email ? String(user.email).split("@")[0] : "Member");

    const profileData = await saveAccountProfile({
      displayName,
      requestedRole,
      newsletterSubscribed: true,
    });
    return profileData;
  }

  async function signUpWithEmail({ displayName, email, password, requestedRole }) {
    if (!configured) {
      throw new Error("Supabase auth is not configured yet.");
    }

    const supabase = getSupabaseClient();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const normalizedDisplayName = String(displayName || "").trim();
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const normalizedPassword = String(password || "");

      if (!normalizedDisplayName) {
        throw new Error("Please add a display name.");
      }

      if (normalizedPassword.length < 8) {
        throw new Error("Use a stronger password with at least 8 characters.");
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: normalizedPassword,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          data: {
            display_name: normalizedDisplayName,
            requested_role: requestedRole,
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      setPendingRequestedRole(requestedRole);

      if (data.session?.user) {
        const nextProfile = await syncProfile(data.session.user, {
          displayName: normalizedDisplayName,
          requestedRole,
        });
        setProfile(nextProfile);
        setSession(data.session);
        setNotice("Account created successfully.");
      } else {
        setNotice("Account created. Check your email to confirm the signup link.");
      }
    } catch (authError) {
      console.error("[auth-ui] signUpWithEmail failed", authError);
      setError(normalizeAuthError(authError));
      throw authError;
    } finally {
      setBusy(false);
    }
  }

  async function signInWithEmail({ email, password }) {
    if (!configured) {
      throw new Error("Supabase auth is not configured yet.");
    }

    const supabase = getSupabaseClient();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const normalizedPassword = String(password || "");

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword,
      });

      if (signInError) {
        throw signInError;
      }

      if (data.session?.user) {
        const nextProfile = await syncProfile(data.session.user);
        setProfile(nextProfile);
        setSession(data.session);
      }
      setNotice("Signed in successfully.");
    } catch (authError) {
      console.error("[auth-ui] signInWithEmail failed", authError);
      setError(normalizeAuthError(authError));
      throw authError;
    } finally {
      setBusy(false);
    }
  }

  async function signInWithProvider(provider, requestedRole) {
    if (!configured) {
      throw new Error("Supabase auth is not configured yet.");
    }

    const supabase = getSupabaseClient();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      setPendingRequestedRole(requestedRole);
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: getAuthRedirectUrl(),
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
        },
      });

      if (oauthError) {
        throw oauthError;
      }
    } catch (authError) {
      console.error("[auth-ui] signInWithProvider failed", { provider, error: authError });
      setError(normalizeAuthError(authError, { provider }));
      clearPendingRequestedRole();
      throw authError;
    } finally {
      setBusy(false);
    }
  }

  async function signOutUser() {
    if (!configured) {
      return;
    }

    const supabase = getSupabaseClient();
    setBusy(true);
    setError("");

    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) {
        throw signOutError;
      }
      clearPendingRequestedRole();
    } catch (authError) {
      console.error("[auth-ui] signOut failed", authError);
      setError(normalizeAuthError(authError));
      throw authError;
    } finally {
      setBusy(false);
    }
  }

  function openAuthPrompt(message) {
    setPromptMessage(message || "Please sign in to continue.");
  }

  function closeAuthPrompt() {
    setPromptMessage("");
  }

  return {
    configured,
    loading,
    busy,
    error,
    notice,
    promptMessage,
    callbackReady,
    session,
    user: session?.user || null,
    profile,
    setError,
    setNotice,
    openAuthPrompt,
    closeAuthPrompt,
    signUpWithEmail,
    signInWithEmail,
    signInWithProvider,
    signOutUser,
    refreshProfile: async () => {
      if (!session?.user) {
        return null;
      }
      const nextProfile = await fetchAccountProfile();
      setProfile(nextProfile);
      return nextProfile;
    },
  };
}

function useEngagement(auth) {
  const [statsMap, setStatsMap] = useState({});
  const [profile, setProfile] = useState(() => loadStoredProfile());
  const [error, setError] = useState("");
  const [storage, setStorage] = useState("file");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    persistProfile(profile);
  }, [profile]);

  useEffect(() => {
    let active = true;
    const syncIntervalMs = 4000;

    async function sync({ silent = false } = {}) {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;

      try {
        const response = await fetchEngagementStats();
        if (!active || requestRef.current !== requestId) {
          return response;
        }

        setStatsMap(response.stats);
        setStorage(response.storage);
        setLastUpdatedAt(response.updatedAt);
        setError("");
        return response;
      } catch (loadError) {
        if (!active || requestRef.current !== requestId) {
          return null;
        }

        if (!silent) {
          setError(loadError.message);
        }
        return null;
      }
    }

    sync();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        sync({ silent: true });
      }
    }, syncIntervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        sync({ silent: true });
      }
    };

    const handleFocus = () => {
      sync({ silent: true });
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function saveProfile(updates) {
    setProfile((current) => ({
      actorId: auth.user?.id || current.actorId || createActorId(),
      name: updates.name ?? auth.profile?.displayName ?? current.name ?? "",
      email: updates.email ?? auth.user?.email ?? current.email ?? "",
    }));
  }

  async function refresh() {
    try {
      const response = await fetchEngagementStats();
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      setError("");
      return response.stats;
    } catch (loadError) {
      const message = buildEngagementErrorMessage(loadError);
      console.error("[engagement-ui] refresh failed", {
        message,
        requestId: loadError?.requestId || "",
      });
      setError(message);
      throw loadError;
    }
  }

  async function handleToggleLike({ entityType, entityId, actorName }) {
    if (!auth.user) {
      auth.openAuthPrompt("Sign in to like posts, articles, and projects.");
      throw new Error("Please sign in to like this content.");
    }

    const nextProfile = {
      actorId: auth.user.id,
      name: actorName || auth.profile?.displayName || profile.name || "Member",
      email: auth.user.email || profile.email,
    };
    setProfile(nextProfile);
    setError("");

    const previousStatsMap = statsMap;
    const optimisticStatsMap = applyOptimisticLikeToggle(statsMap, entityType, entityId, {
      actorId: nextProfile.actorId,
      actorName: nextProfile.name,
    });
    setStatsMap(optimisticStatsMap);

    try {
      const response = await toggleLike({
        entityType,
        entityId,
        actorId: nextProfile.actorId,
        actorName: nextProfile.name,
      });
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      return response.stats[entityKey(entityType, entityId)] || null;
    } catch (toggleError) {
      setStatsMap(previousStatsMap);
      const message = buildEngagementErrorMessage(toggleError);
      console.error("[engagement-ui] toggle like failed", {
        entityType,
        entityId,
        message,
        requestId: toggleError?.requestId || "",
      });
      setError(message);
      throw toggleError;
    }
  }

  async function handleCreateComment({ entityType, entityId, authorName, authorEmail, message }) {
    if (!auth.user) {
      auth.openAuthPrompt("Sign in to post comments and keep them attached to your account.");
      throw new Error("Please sign in to comment.");
    }

    const nextProfile = {
      actorId: auth.user.id,
      name: authorName || auth.profile?.displayName || profile.name,
      email: auth.user.email || authorEmail || profile.email,
    };
    setProfile(nextProfile);

    try {
      const response = await createComment({
        entityType,
        entityId,
        actorId: nextProfile.actorId,
        authorName: nextProfile.name,
        authorEmail: nextProfile.email,
        message,
      });
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      setError("");
      return response.stats[entityKey(entityType, entityId)] || null;
    } catch (commentError) {
      const message = buildEngagementErrorMessage(commentError);
      console.error("[engagement-ui] comment failed", {
        entityType,
        entityId,
        message,
        requestId: commentError?.requestId || "",
      });
      setError(message);
      throw commentError;
    }
  }

  async function handleDeleteComment({ entityType, entityId, commentId }) {
    if (!auth.user) {
      auth.openAuthPrompt("Sign in to manage your comments.");
      throw new Error("Please sign in to delete your comment.");
    }

    try {
      const response = await deleteComment({
        entityType,
        entityId,
        commentId,
      });
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      setError("");
      return response.stats[entityKey(entityType, entityId)] || null;
    } catch (deleteError) {
      const message = buildEngagementErrorMessage(deleteError);
      console.error("[engagement-ui] delete comment failed", {
        entityType,
        entityId,
        commentId,
        message,
        requestId: deleteError?.requestId || "",
      });
      setError(message);
      throw deleteError;
    }
  }

  async function handleIncrementView({ entityType, entityId }) {
    try {
      const response = await incrementView({
        entityType,
        entityId,
      });
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      setError("");
      return response.stats[entityKey(entityType, entityId)] || null;
    } catch (viewError) {
      const message = buildEngagementErrorMessage(viewError);
      console.error("[engagement-ui] increment view failed", {
        entityType,
        entityId,
        message,
        requestId: viewError?.requestId || "",
      });
      setError(message);
      throw viewError;
    }
  }

  return {
    statsMap,
    profile: {
      actorId: auth.user?.id || profile.actorId,
      name: auth.profile?.displayName || profile.name,
      email: auth.user?.email || profile.email,
    },
    auth,
    error,
    storage,
    lastUpdatedAt,
    saveProfile,
    refresh,
    toggleLike: handleToggleLike,
    createComment: handleCreateComment,
    deleteComment: handleDeleteComment,
    incrementView: handleIncrementView,
  };
}

function describeEngagementStorage(storage) {
  if (storage === "database") {
    return "Likes and comments are synced through Supabase or another Postgres database.";
  }
  if (storage === "blob") {
    return "Likes and comments are shared through Vercel Blob storage.";
  }
  return "Likes and comments are stored locally in the development JSON dataset.";
}

function buildEngagementErrorMessage(error) {
  const baseMessage = error?.message || "Something went wrong while syncing engagement.";
  const requestId = String(error?.requestId || "").trim();
  if (!requestId) {
    return baseMessage;
  }
  return `${baseMessage} Reference: ${requestId}`;
}

function loadStoredProfile() {
  if (typeof window === "undefined") {
    return { actorId: "", name: "", email: "" };
  }

  try {
    const raw = window.localStorage.getItem("dexteritycoder-profile");
    if (!raw) {
      return { actorId: createActorId(), name: "", email: "" };
    }

    const parsed = JSON.parse(raw);
    return {
      actorId: parsed.actorId || createActorId(),
      name: parsed.name || "",
      email: parsed.email || "",
    };
  } catch {
    return { actorId: createActorId(), name: "", email: "" };
  }
}

function persistProfile(profile) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem("dexteritycoder-profile", JSON.stringify(profile));
}

function createActorId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `guest-${Math.random().toString(36).slice(2, 12)}`;
}

function TransitionLink({ href, className, children, style, ...rest }) {
  const navigateWithTransition = useTransitionNavigate();
  const externalOnClick = rest.onClick;

  function handleClick(event) {
    if (typeof externalOnClick === "function") {
      externalOnClick(event);
    }

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target === "_blank" ||
      !href.startsWith("/")
    ) {
      return;
    }

    event.preventDefault();
    navigateWithTransition(href);
  }

  const linkProps = { ...rest };
  delete linkProps.onClick;

  return (
    <a {...linkProps} href={href} className={className} style={style} onClick={handleClick}>
      {children}
    </a>
  );
}

function EngagementPanel({ entityType, entityId, engagement, title = "Comments & Likes" }) {
  const stats = getEntityStats(engagement.statsMap, entityType, entityId);
  const viewerHasLiked = stats.likedBy.some((entry) => entry.actorId === engagement.profile.actorId);
  const signedIn = Boolean(engagement.auth?.user);
  const [authorName, setAuthorName] = useState(engagement.profile.name || "");
  const [authorEmail, setAuthorEmail] = useState(engagement.profile.email || "");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyCommentId, setBusyCommentId] = useState("");

  useEffect(() => {
    setAuthorName(engagement.profile.name || "");
    setAuthorEmail(engagement.profile.email || "");
  }, [engagement.profile.email, engagement.profile.name]);

  async function handleLikeClick() {
    if (!signedIn) {
      engagement.auth.openAuthPrompt("Sign in to like posts, articles, and projects.");
      setActionError("Please sign in to like this content.");
      return;
    }

    const trimmedName = authorName.trim() || engagement.profile.name.trim();
    if (!trimmedName) {
      setActionError("Enter your name before liking this post.");
      return;
    }

    setBusyAction("like");
    setActionError("");

    try {
      engagement.saveProfile({ name: trimmedName, email: authorEmail.trim() });
      await engagement.toggleLike({
        entityType,
        entityId,
        actorName: trimmedName,
      });
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteCommentClick(commentId) {
    setBusyCommentId(commentId);
    setActionError("");

    try {
      await engagement.deleteComment({
        entityType,
        entityId,
        commentId,
      });
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyCommentId("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedName = authorName.trim();
    const trimmedMessage = message.trim();
    if (!trimmedName || !trimmedMessage) {
      setActionError("Name and comment are both required.");
      return;
    }

    setBusyAction("comment");
    setActionError("");

    try {
      engagement.saveProfile({ name: trimmedName, email: authorEmail.trim() });
      await engagement.createComment({
        entityType,
        entityId,
        authorName: trimmedName,
        authorEmail: authorEmail.trim(),
        message: trimmedMessage,
      });
      setMessage("");
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyAction("");
    }
  }

  return (
    <section className="engagement-panel">
      <div className="engagement-header">
        <div>
          <h2>{title}</h2>
          <p>{describeEngagementStorage(engagement.storage)}</p>
        </div>
        <button
          type="button"
          className={`engagement-like-btn${viewerHasLiked ? " is-active" : ""}`}
          onClick={handleLikeClick}
          disabled={busyAction === "like"}
        >
          {viewerHasLiked ? "Unlike" : "Like"} · {formatCount(stats.likeCount)}
        </button>
      </div>

      <div className="engagement-stats-row">
        <span>{formatCount(stats.commentCount)} comments</span>
        <span>{formatCount(stats.likeCount)} likes</span>
        <span>{stats.likedBy.length > 0 ? `Recent likes: ${stats.likedBy.slice(0, 3).map((entry) => entry.actorName).join(", ")}` : "Be the first recent like."}</span>
      </div>

      {actionError ? <p className="engagement-error">{actionError}</p> : null}
      {engagement.error ? <p className="engagement-error">{engagement.error}</p> : null}

      <form className="engagement-form" onSubmit={handleSubmit}>
        {signedIn ? (
          <p className="engagement-auth-note">Signed in as {engagement.profile.name || engagement.auth.user.email}</p>
        ) : (
          <div className="engagement-form-grid">
            <input
              type="text"
              placeholder="Your name"
              value={authorName}
              onChange={(event) => setAuthorName(event.target.value)}
              maxLength={80}
              required
            />
            <input
              type="email"
              placeholder="Email (optional)"
              value={authorEmail}
              onChange={(event) => setAuthorEmail(event.target.value)}
              maxLength={160}
            />
          </div>
        )}
        <textarea
          placeholder={signedIn ? "Write your comment here..." : "Sign in to write a comment..."}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows="5"
          maxLength={2000}
          required
          disabled={!signedIn}
        ></textarea>
        <button type="submit" className="engagement-submit-btn" disabled={busyAction === "comment" || !signedIn}>
          {busyAction === "comment" ? "Posting..." : "Post Comment"}
        </button>
        {!signedIn ? (
          <button type="button" className="engagement-submit-btn" onClick={() => engagement.auth.openAuthPrompt("Sign in to comment and keep your activity saved to your account.")}>
            Sign Up / Log In
          </button>
        ) : null}
      </form>

      <div className="engagement-comments">
        {stats.comments.length === 0 ? (
          <p className="engagement-empty-state">No recent comments yet. Start the conversation.</p>
        ) : (
          stats.comments.map((comment) => (
            <article key={comment.id} className="engagement-comment-card">
              <div className="engagement-comment-meta">
                <div className="engagement-comment-meta-main">
                  <strong>{comment.authorName}</strong>
                  <span>{formatCommentDate(comment.createdAt)}</span>
                </div>
                  <button
                    type="button"
                    className="engagement-comment-remove-btn"
                    onClick={() => handleDeleteCommentClick(comment.id)}
                    disabled={busyCommentId === comment.id}
                    hidden={comment.actorId !== engagement.auth?.user?.id}
                  >
                    {busyCommentId === comment.id ? "Removing..." : "Remove"}
                  </button>
              </div>
              <p>{comment.message}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function LikeButton({ entityType, entityId, engagement, className = "", showCount = true }) {
  const stats = getEntityStats(engagement.statsMap, entityType, entityId);
  const viewerHasLiked = stats.likedBy.some((entry) => entry.actorId === engagement.profile.actorId);
  const [busy, setBusy] = useState(false);
  const [isPopping, setIsPopping] = useState(false);

  async function handleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) {
      return;
    }

    const willLike = !viewerHasLiked;
    setBusy(true);

    try {
      if (willLike) {
        setIsPopping(false);
        window.setTimeout(() => {
          setIsPopping(true);
          window.setTimeout(() => setIsPopping(false), 280);
        }, 0);
      }
      await engagement.toggleLike({
        entityType,
        entityId,
        actorName: engagement.profile.name || "Guest",
      });
    } catch (error) {
      console.error("[engagement-ui] like button failed", {
        entityType,
        entityId,
        message: error?.message || "",
        requestId: error?.requestId || "",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`like-button${viewerHasLiked ? " is-active" : ""}${isPopping ? " is-popping" : ""}${busy ? " is-busy" : ""}${className ? ` ${className}` : ""}`}
      onClick={handleClick}
      aria-label={viewerHasLiked ? "Unlike" : "Like"}
      aria-pressed={viewerHasLiked}
    >
      <span className="like-button-heart">{viewerHasLiked ? "♥" : "♡"}</span>
      {showCount ? <span className="like-button-count">{formatCount(stats.likeCount)}</span> : null}
    </button>
  );
}

function applyOptimisticLikeToggle(currentStatsMap, entityType, entityId, actor) {
  const key = entityKey(entityType, entityId);
  const currentStats = getEntityStats(currentStatsMap, entityType, entityId);
  const likedBy = Array.isArray(currentStats.likedBy) ? [...currentStats.likedBy] : [];
  const existingIndex = likedBy.findIndex((entry) => entry.actorId === actor.actorId);
  const isCurrentlyLiked = existingIndex >= 0;

  if (isCurrentlyLiked) {
    likedBy.splice(existingIndex, 1);
  } else {
    likedBy.unshift({
      actorId: actor.actorId,
      actorName: actor.actorName,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    ...currentStatsMap,
    [key]: {
      commentCount: Number(currentStats.commentCount || 0),
      likeCount: Math.max(0, Number(currentStats.likeCount || 0) + (isCurrentlyLiked ? -1 : 1)),
      comments: Array.isArray(currentStats.comments) ? [...currentStats.comments] : [],
      likedBy,
    },
  };
}

function CommentsPanel({ entityType, entityId, engagement, title = "Comments" }) {
  const stats = getEntityStats(engagement.statsMap, entityType, entityId);
  const signedIn = Boolean(engagement.auth?.user);
  const [authorName, setAuthorName] = useState(engagement.profile.name || "");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyCommentId, setBusyCommentId] = useState("");

  useEffect(() => {
    setAuthorName(engagement.profile.name || "");
  }, [engagement.profile.name]);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedName = authorName.trim();
    const trimmedMessage = message.trim();
    if (!trimmedName || !trimmedMessage) {
      setActionError("Name and comment are both required.");
      return;
    }

    setBusyAction("comment");
    setActionError("");

    try {
      engagement.saveProfile({ name: trimmedName });
      await engagement.createComment({
        entityType,
        entityId,
        authorName: trimmedName,
        authorEmail: "",
        message: trimmedMessage,
      });
      setMessage("");
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteCommentClick(commentId) {
    setBusyCommentId(commentId);
    setActionError("");

    try {
      await engagement.deleteComment({
        entityType,
        entityId,
        commentId,
      });
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyCommentId("");
    }
  }

  return (
    <section className="engagement-stack">
      <div className="engagement-panel engagement-panel-minimal">
        <div className="engagement-header">
          <h2>{title}</h2>
          <span className="engagement-count">{formatCount(stats.commentCount)} comments</span>
        </div>

        {actionError ? <p className="engagement-error">{actionError}</p> : null}
        {engagement.error ? <p className="engagement-error">{engagement.error}</p> : null}

        <form className="engagement-form" onSubmit={handleSubmit}>
          <div className="engagement-form-top">
            {!signedIn ? (
              <input
                type="text"
                placeholder="Your name"
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
                maxLength={80}
                required
              />
            ) : (
              <p className="engagement-auth-note">Signed in as {engagement.profile.name || engagement.auth.user.email}</p>
            )}
            <button type="submit" className="engagement-submit-btn" disabled={busyAction === "comment" || !signedIn}>
              {busyAction === "comment" ? "Posting..." : "Comment"}
            </button>
          </div>
          <textarea
            placeholder={signedIn ? "Write a comment..." : "Sign in to write a comment..."}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows="3"
            maxLength={2000}
            required
            disabled={!signedIn}
          ></textarea>
          {!signedIn ? (
            <button type="button" className="engagement-submit-btn" onClick={() => engagement.auth.openAuthPrompt("Sign in to comment and keep your activity saved to your account.")}>
              Sign Up / Log In
            </button>
          ) : null}
        </form>
      </div>

      <section className="engagement-comments-section" aria-label={`Existing ${title.toLowerCase()}`}>
        <div className="engagement-comments-section-header">
          <h3>Existing Comments</h3>
          <span className="engagement-count">{formatCount(stats.commentCount)} total</span>
        </div>
        <div className="engagement-comments">
          {stats.comments.length === 0 ? (
            <p className="engagement-empty-state">No comments yet.</p>
          ) : (
            stats.comments.map((comment) => (
              <article key={comment.id} className="engagement-comment-card">
                <div className="engagement-comment-meta">
                  <div className="engagement-comment-meta-main">
                    <strong>{comment.authorName}</strong>
                    <span>{formatCommentDate(comment.createdAt)}</span>
                  </div>
                  <button
                    type="button"
                    className="engagement-comment-remove-btn"
                    onClick={() => handleDeleteCommentClick(comment.id)}
                    disabled={busyCommentId === comment.id}
                    hidden={comment.actorId !== engagement.auth?.user?.id}
                  >
                    {busyCommentId === comment.id ? "Removing..." : "Remove"}
                  </button>
                </div>
                <p>{comment.message}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  );
}

function SocialFooter({ footer }) {
  return (
    <section className="whole_footer">
      <footer>
        <div className="social-icons">
          {footer.socials.map((social) => (
            <a
              key={social.label}
              href={social.href}
              aria-label={social.label}
              target="_blank"
              rel="noreferrer"
            >
              <img src={social.icon} alt="" />
            </a>
          ))}
        </div>
        <hr className="footer_hr" />
        <div className="newsletter">
          <h1>{footer.brand}</h1>
          <form action="#">
            <p>{footer.newsletterPrompt}</p>
            <input type="email" required />
            <div className="newsletter-check">
              <input type="checkbox" id="subscribe" />
              <label htmlFor="subscribe">{footer.newsletterCheckbox}</label>
            </div>
            <button type="submit">{footer.newsletterButton}</button>
          </form>
        </div>
        <hr className="footer_hr" />
        <div className="copyright">
          <p>{footer.copyright}</p>
        </div>
      </footer>
    </section>
  );
}

function MinimalFooter({ footer }) {
  return (
    <footer>
      <div className="copyright">
        <p>{footer.copyright}</p>
      </div>
    </footer>
  );
}

function Navbar({ siteData, auth }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    function handleOutsideClick(event) {
      const nav = document.getElementById("rightnav");
      const trigger = document.querySelector(".ham");

      if (!menuOpen || !nav || !trigger) {
        return;
      }

      if (!nav.contains(event.target) && !trigger.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [menuOpen]);

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => {
      document.body.classList.remove("menu-open");
    };
  }, [menuOpen]);

  return (
    <>
      <button
        className="ham"
        aria-label="Open menu"
        type="button"
        onClick={() => setMenuOpen((value) => !value)}
      >
        <div className="line"></div>
        <div className="line"></div>
        <div className="line"></div>
      </button>
      <div className="navbar">
        <div id="leftnav">
          <TransitionLink href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <h4>DEXTERITYCODER</h4>
          </TransitionLink>
        </div>
        <div id="rightnav">
          <ul id="rightnavul">
            {siteData.navigation.map((item) => (
              <TransitionLink key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
                <li>{item.label}</li>
              </TransitionLink>
            ))}
            {auth.user ? (
              <>
                <TransitionLink href="/account" onClick={() => setMenuOpen(false)}>
                  <li>ACCOUNT</li>
                </TransitionLink>
                <a
                  href="#sign-out"
                  onClick={(event) => {
                    event.preventDefault();
                    setMenuOpen(false);
                    auth.signOutUser().catch(() => {
                      // Error state is already tracked by auth.
                    });
                  }}
                >
                  <li>LOG OUT</li>
                </a>
              </>
            ) : (
              <TransitionLink href="/auth" className="nav-auth-cta" onClick={() => setMenuOpen(false)}>
                <li>SIGN UP</li>
              </TransitionLink>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}

function Hero({ titleHtml, backgroundImage, titleStyle, meta, heroClassName = "hero" }) {
  const style = backgroundImage
    ? {
        backgroundImage: `linear-gradient(rgba(18, 18, 18, 0.38), rgba(18, 18, 18, 0.58)), url('${backgroundImage}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : undefined;

  return (
    <section className={heroClassName} style={style}>
      <div className="hero-inner">
        <h1 style={titleStyle} dangerouslySetInnerHTML={{ __html: titleHtml }}></h1>
        {meta ? <p className="project-hero-meta">{meta}</p> : null}
      </div>
    </section>
  );
}

function Gallery({ items }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [itemsPerView, setItemsPerView] = useState(getItemsPerView());
  const [activeImageIndex, setActiveImageIndex] = useState(-1);
  const touchStartXRef = useRef(0);
  const touchDeltaXRef = useRef(0);

  useEffect(() => {
    function handleResize() {
      setItemsPerView(getItemsPerView());
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const maxIndex = Math.max(items.length - itemsPerView, 0);
    setCurrentIndex((index) => Math.min(index, maxIndex));
  }, [items.length, itemsPerView]);

  useEffect(() => {
    if (activeImageIndex < 0) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setActiveImageIndex(-1);
      } else if (event.key === "ArrowLeft") {
        setActiveImageIndex((index) => (index <= 0 ? items.length - 1 : index - 1));
      } else if (event.key === "ArrowRight") {
        setActiveImageIndex((index) => (index >= items.length - 1 ? 0 : index + 1));
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeImageIndex, items.length]);

  const maxIndex = Math.max(items.length - itemsPerView, 0);
  const offsetPercent = itemsPerView === 1 ? 100 : itemsPerView === 2 ? 50 : 33.333333;

  function showPreviousSlide() {
    setCurrentIndex((index) => Math.max(index - 1, 0));
  }

  function showNextSlide() {
    setCurrentIndex((index) => Math.min(index + 1, maxIndex));
  }

  function showPreviousImage() {
    setActiveImageIndex((index) => (index <= 0 ? items.length - 1 : index - 1));
  }

  function showNextImage() {
    setActiveImageIndex((index) => (index >= items.length - 1 ? 0 : index + 1));
  }

  function handleTouchStart(event) {
    touchStartXRef.current = event.touches[0]?.clientX || 0;
    touchDeltaXRef.current = 0;
  }

  function handleTouchMove(event) {
    const currentX = event.touches[0]?.clientX || 0;
    touchDeltaXRef.current = currentX - touchStartXRef.current;
  }

  function handleTouchEnd() {
    const threshold = 45;
    if (touchDeltaXRef.current <= -threshold) {
      showNextSlide();
    } else if (touchDeltaXRef.current >= threshold) {
      showPreviousSlide();
    }

    touchStartXRef.current = 0;
    touchDeltaXRef.current = 0;
  }

  return (
    <>
      <div className="gallery-container">
        <div className="gallery-title">GALLERY</div>
        <div
          className="gallery-viewport"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="gallery-slider"
            style={{ transform: `translateX(-${currentIndex * offsetPercent}%)` }}
          >
            {items.map((item, index) => (
              <button
                key={item.image}
                type="button"
                className="gallery-item"
                onClick={() => setActiveImageIndex(index)}
                aria-label={`Open image ${index + 1} of ${items.length}`}
              >
                <img src={item.image} alt={item.alt} />
              </button>
            ))}
          </div>
        </div>
        <button
          className="gallery-button left"
          type="button"
          aria-label="Previous gallery items"
          onClick={showPreviousSlide}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          className="gallery-button right"
          type="button"
          aria-label="Next gallery items"
          onClick={showNextSlide}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {activeImageIndex >= 0 ? (
        <div
          className="gallery-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          onClick={() => setActiveImageIndex(-1)}
        >
          <div className="gallery-modal-inner" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="gallery-modal-close"
              aria-label="Close image viewer"
              onClick={() => setActiveImageIndex(-1)}
            >
              ×
            </button>
            <button
              type="button"
              className="gallery-modal-nav left"
              aria-label="Previous image"
              onClick={showPreviousImage}
            >
              ‹
            </button>
            <figure className="gallery-modal-figure">
              <img src={items[activeImageIndex]?.image} alt={items[activeImageIndex]?.alt || "Gallery image"} />
              {items[activeImageIndex]?.alt ? <figcaption>{items[activeImageIndex].alt}</figcaption> : null}
            </figure>
            <button
              type="button"
              className="gallery-modal-nav right"
              aria-label="Next image"
              onClick={showNextImage}
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function getItemsPerView() {
  if (window.innerWidth <= 680) {
    return 1;
  }
  if (window.innerWidth <= 1200) {
    return 2;
  }
  return 3;
}

function useViewTracker(engagement, entityType, entityId) {
  const trackedRef = useRef("");

  useEffect(() => {
    if (!entityType || !entityId) {
      return;
    }

    const key = entityKey(entityType, entityId);
    if (trackedRef.current === key) {
      return;
    }

    trackedRef.current = key;
    engagement.incrementView({ entityType, entityId }).catch(() => {
      // Shared engagement state already records the error.
    });
  }, [engagement, entityId, entityType]);
}

function WorkCard({ card, stats, engagement, entityType = "article", entityId = card.slug }) {
  const navigateWithTransition = useTransitionNavigate();
  const fallbackViewCount = parseLooseCount(card.views);
  const fallbackCommentCount = parseLooseCount(card.comments);
  const fallbackLikeCount = parseLooseCount(card.likes);
  const viewCount = stats && Number(stats.viewCount) > 0 ? stats.viewCount : fallbackViewCount;
  const commentCount = stats ? stats.commentCount : fallbackCommentCount;
  const likeCount = stats ? stats.likeCount : fallbackLikeCount;

  return (
    <div
      className="blog-card"
      data-post={card.slug}
      onClick={() => navigateWithTransition(`/${card.slug}`)}
    >
      <LikeButton
        entityType={entityType}
        entityId={entityId}
        engagement={engagement}
        className="card-like-button"
        showCount={false}
      />
      <div className="blog-card-media">
        <img src={card.image} alt="Dexteritycoder featured post" />
      </div>
      <div className="blog-content">
        <div className="meta">{card.meta}</div>
        <h3>{card.title}</h3>
        <p>{card.description}</p>
        <div className="blog-footer">
          <span className="views">{formatCount(viewCount)} views</span>
          <span className="comments">{formatCount(commentCount)} comments</span>
          <span className="like">{formatCount(likeCount)} likes</span>
        </div>
      </div>
    </div>
  );
}

function MarkdownContent({ markdown }) {
  return <section className="post-content" dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }}></section>;
}

function Shell({ siteData, auth, children }) {
  return (
    <>
      <Navbar siteData={siteData} auth={auth || { user: null, signOutUser: async () => {} }} />
      {children}
      <SocialFooter footer={siteData.footer} />
    </>
  );
}

function HomePage({ siteData, engagement, auth }) {
  usePageSetup("Dexteritycoder", "home-page");

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml={siteData.home.heroTitleHtml} />
      <section className="home-blog-grid">
        {siteData.home.works.map((card) => (
          <WorkCard
            key={card.slug}
            card={card}
            stats={getEntityStats(engagement.statsMap, "article", card.slug)}
            engagement={engagement}
          />
        ))}
      </section>
      <div className="all_posts_btn">
        <center>
          <TransitionLink href="/works">
            <button type="button">View All Works</button>
          </TransitionLink>
        </center>
      </div>
      <Gallery items={siteData.home.gallery} />
    </Shell>
  );
}

function WorksPage({ siteData, engagement, auth }) {
  usePageSetup("Writings | Dexteritycoder", "home-page");

  const cards = siteData.home.works.map((card) => ({
    ...card,
    views: card.views,
    comments: "0 comments",
    likes: "20",
  }));

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml={siteData.works.listing.heroTitleHtml} />
      <section className="home-blog-grid">
        {cards.map((card) => (
          <WorkCard
            key={card.slug}
            card={card}
            stats={getEntityStats(engagement.statsMap, "article", card.slug)}
            engagement={engagement}
          />
        ))}
      </section>
    </Shell>
  );
}

function WorkMarkdownPage({ siteData, slug, production = false, engagement, auth }) {
  const page = siteData.works.pages[slug];
  const { data, error, loading } = useText(page.markdownPath);
  const [projects, setProjects] = useState([]);
  const navigateWithTransition = useTransitionNavigate();

  usePageSetup(page.documentTitle, "post-page");
  useViewTracker(engagement, "article", slug);

  useEffect(() => {
    if (!production) {
      return undefined;
    }

    let active = true;
    loadProjectsFromJson()
      .then((items) => {
        if (active) {
          setProjects(normalizeData(items));
        }
      })
      .catch(() => {
        if (active) {
          setProjects([]);
        }
      });

    return () => {
      active = false;
    };
  }, [production]);

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={page.heroTitle}
        backgroundImage={page.heroImage}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
      />
      <main className="post-article production-projects-page">
        <article>
          <div className="meta">{page.meta}</div>
          {loading ? <section className="post-content"><p>Loading...</p></section> : null}
          {error ? <section className="post-content"><p>Error loading content.</p></section> : null}
          {!loading && !error ? <MarkdownContent markdown={data} /> : null}
          <TransitionLink href={page.ctaHref}>
            <button className="call-to-blog-button">{page.ctaLabel}</button>
          </TransitionLink>
          <div className="post-engagement-strip">
            <span className="post-engagement-comments">
              {formatCount(getEntityStats(engagement.statsMap, "article", slug).viewCount)} views
            </span>
            <LikeButton entityType="article" entityId={slug} engagement={engagement} className="detail-like-button" />
            <span className="post-engagement-comments">
              {formatCount(getEntityStats(engagement.statsMap, "article", slug).commentCount)} comments
            </span>
          </div>
          <CommentsPanel entityType="article" entityId={slug} engagement={engagement} title="Article Comments" />
        </article>
        {production ? (
          <section className="production-projects-section" aria-label="Featured production projects">
            <h2 className="production-projects-heading">Featured Projects</h2>
            <p className="production-projects-subtitle">
              Each card opens the README and repository files in your browser static frontend only, no backend server.
            </p>
            <div className="project-cards-grid">
              {projects.map((project) => {
                const parsed = parseGithubUrl(project.github);
                const repo = parsed ? repoSlug(parsed.owner, parsed.repo) : "";

                return (
                  <article
                    key={project.github}
                    className="blog-card project-card"
                    onClick={() => navigateWithTransition(buildProjectRoute(repo))}
                  >
                <LikeButton
                  entityType="project"
                  entityId={project.id}
                  engagement={engagement}
                  className="card-like-button"
                  showCount={false}
                />
                    <div className="blog-card-media">
                      <img src={project.image} alt={project.title} />
                    </div>
                    <div className="blog-content">
                      <div className="meta">{project.meta || "Open Source"}</div>
                      <h3>{project.title}</h3>
                      <p>{project.description}</p>
                      <div className="blog-footer">
                        <span className="views">{formatCount(getEntityStats(engagement.statsMap, "project", project.id).viewCount)} views</span>
                        <span className="comments">
                          {formatCount(getEntityStats(engagement.statsMap, "project", project.id).commentCount)} comments
                        </span>
                        <span className="like">{formatCount(getEntityStats(engagement.statsMap, "project", project.id).likeCount)} likes</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </main>
    </Shell>
  );
}

function AboutPage({ siteData, auth }) {
  const { data, error, loading } = useText(siteData.about.markdownPath);
  usePageSetup(siteData.about.documentTitle);

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={siteData.about.heroTitleHtml}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
      />
      <main className="post-article">
        <article>
          {loading ? <section className="post-content"><p>Loading...</p></section> : null}
          {error ? <section className="post-content"><p>Error loading content.</p></section> : null}
          {!loading && !error ? <MarkdownContent markdown={data} /> : null}
        </article>
        <TransitionLink href={siteData.about.ctaHref}>
          <button className="call-to-blog-button">{siteData.about.ctaLabel}</button>
        </TransitionLink>
      </main>
      <Gallery items={siteData.about.gallery} />
    </Shell>
  );
}

function ContactPage({ siteData, auth }) {
  usePageSetup(siteData.contact.documentTitle);

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={siteData.contact.heroTitleHtml}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
      />
      <div className="contact-form-container">
        <form className="contact-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="fullName">Full Name</label>
              <input type="text" id="fullName" name="fullName" placeholder="Enter your full name" required />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input type="email" id="email" name="email" placeholder="Enter your email address" required />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="message">Message</label>
            <textarea id="message" name="message" rows="5" placeholder="Write your message..." required></textarea>
          </div>
          <br />
          <button type="submit" className="submit-btn">Send Message</button>
        </form>
      </div>
    </Shell>
  );
}

function DonatePage({ siteData, auth }) {
  usePageSetup(siteData.donate.documentTitle);

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={siteData.donate.heroTitleHtml}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
      />
      <div className="donate-container">
        <div className="donate-text">
          <h2 style={{ marginTop: 0 }}>{siteData.donate.heading}</h2>
          <p>{siteData.donate.description}</p>
        </div>
        <div className="donate-iframe-container">
          <iframe id="donate-iframe" src={siteData.donate.iframeUrl} frameBorder="0" allowFullScreen></iframe>
        </div>
      </div>
    </Shell>
  );
}

function BlogListPage({ siteData, engagement, auth }) {
  const { data, error, loading } = useJson("/BlogPosts/posts.json");
  const [search, setSearch] = useState("");
  const navigateWithTransition = useTransitionNavigate();
  usePageSetup(siteData.blogs.documentTitle, "home-page");

  const posts = Array.isArray(data) ? [...data].reverse() : [];
  const filteredPosts = posts.filter((post) => {
    const term = search.toLowerCase().trim();
    if (!term) {
      return true;
    }

    return (
      post.title.toLowerCase().includes(term) ||
      post.description.toLowerCase().includes(term) ||
      post.author.toLowerCase().includes(term)
    );
  });

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml={siteData.blogs.heroTitleHtml} />
      <div className="blog-search-container">
        <input
          type="text"
          id="blog-search"
          placeholder={siteData.blogs.searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <svg className="blog-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
      </div>
      <section className="home-blog-grid" id="blog-grid">
        {loading ? <p>Loading...</p> : null}
        {error ? <p style={{ color: "white", textAlign: "center" }}>Error loading writings</p> : null}
        {!loading && !error
          ? filteredPosts.map((post) => (
              <div
                key={post.id}
                className="blog-card"
                data-blog={post.id}
                onClick={() => navigateWithTransition(buildWritingRoute(post.id))}
              >
                <LikeButton
                  entityType="blog"
                  entityId={post.id}
                  engagement={engagement}
                  className="card-like-button"
                  showCount={false}
                />
                <div className="blog-card-media">
                  <img src={post.image} alt={post.title} />
                </div>
                <div className="blog-content">
                  <div className="meta">{`${post.author} · ${post.date} · ${post.readTime}`}</div>
                  <h3>{post.title}</h3>
                  <p>{post.description}</p>
                  <div className="blog-footer">
                    <span className="views">{formatCount(getEntityStats(engagement.statsMap, "blog", post.id).viewCount || post.views)} views</span>
                    <span className="comments">
                      {formatCount(getEntityStats(engagement.statsMap, "blog", post.id).commentCount || post.comments)} comments
                    </span>
                    <span className="like">{formatCount(getEntityStats(engagement.statsMap, "blog", post.id).likeCount || post.likes)} likes</span>
                  </div>
                </div>
              </div>
            ))
          : null}
      </section>
    </Shell>
  );
}

function BlogDetailPage({ siteData, engagement, auth }) {
  const location = useLocation();
  const { blogId: blogIdParam } = useParams();
  const blogId = blogIdParam || new URLSearchParams(location.search).get("blog");
  const { data: posts } = useJson("/BlogPosts/posts.json");
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState(null);

  const post = Array.isArray(posts) ? posts.find((item) => item.id === blogId) : null;
  usePageSetup(post ? `${post.title} | Dexteritycoder` : "Writings | Dexteritycoder", "post-page");
  useViewTracker(engagement, "blog", blogId);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!blogId) {
        setError(new Error("Writing not found"));
        return;
      }

      try {
        const response = await fetch(`/BlogPosts/${blogId}.md`);
        if (!response.ok) {
          throw new Error("Writing not found");
        }

        const text = await response.text();
        if (active) {
          setMarkdown(fixText(text));
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [blogId]);

  const heroHtml = post ? post.title : "Writing Not Found";

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={heroHtml}
        backgroundImage={post?.image}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
        heroClassName="hero"
      />
      <main className="post-article">
        <article>
          <div className="meta" id="blog-meta">
            {post ? `${post.author} · ${post.date} · ${post.readTime}` : "Loading..."}
          </div>
          {error ? <section className="post-content"><p>{error.message}</p></section> : null}
          {!error && markdown ? <MarkdownContent markdown={markdown} /> : null}
          {!error && !markdown ? <section className="post-content"><p>Loading...</p></section> : null}
          {blogId ? (
            <>
              <div className="post-engagement-strip">
                <span className="post-engagement-comments">
                  {formatCount(getEntityStats(engagement.statsMap, "blog", blogId).viewCount || post?.views)} views
                </span>
                <LikeButton entityType="blog" entityId={blogId} engagement={engagement} className="detail-like-button" />
                <span className="post-engagement-comments">
                  {formatCount(getEntityStats(engagement.statsMap, "blog", blogId).commentCount)} comments
                </span>
              </div>
              <CommentsPanel entityType="blog" entityId={blogId} engagement={engagement} title="Writing Comments" />
            </>
          ) : null}
        </article>
      </main>
    </Shell>
  );
}

function TreeNode({ node, onSelect, activePath, depth = 0 }) {
  const children = [...(node.children || [])].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "dir" ? -1 : 1;
    }
    return b.name.localeCompare(a.name);
  });

  return children.map((child) => {
    const icon = child.type === "dir" ? <FolderIcon /> : <FileIcon />;
    const style = child.type === "dir" ? { paddingLeft: `${depth * 14}px` } : { paddingLeft: `${depth * 14 + 14}px` };

    if (child.type === "dir") {
      return (
        <details className="repo-tree-folder" open key={child.path}>
          <summary className="repo-tree-item repo-tree-folder-label" style={style}>
            <span className="repo-tree-icon">{icon}</span>
            <span>{child.name}</span>
          </summary>
          <TreeNode node={child} onSelect={onSelect} activePath={activePath} depth={depth + 1} />
        </details>
      );
    }

    return (
      <button
        type="button"
        key={child.path}
        className={`repo-tree-item repo-tree-file${activePath === child.path ? " is-active" : ""}`}
        style={style}
        onClick={() => onSelect(child)}
      >
        <span className="repo-tree-icon">{icon}</span>
        <span>{child.name}</span>
      </button>
    );
  });
}

function FolderIcon() {
  return (
    <svg className="repo-tree-icon-svg repo-tree-icon-folder" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path>
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="repo-tree-icon-svg repo-tree-icon-file" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 11.25 16h-7.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 7 4.25V1.5Zm5.75.086v2.25a.25.25 0 0 0 .25.25h2.25L6.75 1.5Z"></path>
    </svg>
  );
}

function ProjectDetailPage({ siteData, engagement, auth }) {
  const location = useLocation();
  const { owner: ownerParam, repo: repoParam } = useParams();
  const repoQuery =
    ownerParam && repoParam
      ? `${decodeURIComponent(ownerParam)}/${decodeURIComponent(repoParam)}`
      : new URLSearchParams(location.search).get("repo");
  const [state, setState] = useState({
    loading: true,
    error: null,
    project: null,
    owner: "",
    repo: "",
    branch: "",
    tree: null,
    readmePath: "",
    readmeMarkdown: "",
    docsMarkdown: "",
    fileTitle: "README",
    fileHtml: "<p class='repo-empty-state'>Loading..</p>",
    activePath: "",
  });

  const heroTitle = state.project?.heroTitle || state.project?.title || state.repo || "Loading project..";
  const heroMeta = state.project?.meta || (state.owner && state.repo ? `${state.owner}/${state.repo} · ${state.branch}` : "");
  usePageSetup(`${heroTitle} - Dexteritycoder`, "home-page project-detail-page");
  useViewTracker(engagement, "project", state.project?.id || (!state.loading ? repoQuery : ""));

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        if (!repoQuery) {
          throw new Error("No repository specified.");
        }

        const [owner, repo] = repoQuery.split("/");
        if (!owner || !repo) {
          throw new Error("Invalid repository path. Use owner/repo.");
        }

        const projects = normalizeData(await loadProjectsFromJson());
        const project = projects.find((item) => {
          const parsed = parseGithubUrl(item.github);
          return parsed && repoSlug(parsed.owner, parsed.repo).toLowerCase() === repoSlug(owner, repo).toLowerCase();
        }) || null;

        const repoData = await loadRepoProject(owner, repo);
        const docsMarkdown = project ? await loadProjectDocumentation(project) : null;
        const fileHtml = `<div class="post-content repo-markdown">${markdownToHtml(
          rewriteReadmeAssets(repoData.readmeMarkdown, owner, repo, repoData.branch)
        )}</div>`;

        if (active) {
          setState({
            loading: false,
            error: null,
            project,
            owner,
            repo,
            branch: repoData.branch,
            tree: repoData.tree,
            readmePath: repoData.readmePath || "",
            readmeMarkdown: repoData.readmeMarkdown,
            docsMarkdown: docsMarkdown ? fixText(docsMarkdown) : "",
            fileTitle: repoData.readmePath || "README",
            fileHtml,
            activePath: repoData.readmePath || "",
          });
        }
      } catch (error) {
        if (active) {
          setState((current) => ({ ...current, loading: false, error }));
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [repoQuery]);

  async function handleSelectFile(fileNode) {
    if (fileNode.size > 1024 * 1024) {
      setState((current) => ({
        ...current,
        fileTitle: fileNode.path,
        fileHtml: "<p class='repo-empty-state'>This file is larger than 1 MB and cannot be previewed here.</p>",
        activePath: fileNode.path,
      }));
      return;
    }

    setState((current) => ({
      ...current,
      fileTitle: fileNode.path,
      fileHtml: "<p class='repo-empty-state'>Loading file...</p>",
      activePath: fileNode.path,
    }));

    try {
      const file = await loadRepoFile(state.owner, state.repo, state.branch, fileNode.path);
      if (file.type === "image") {
        setState((current) => ({
          ...current,
          fileHtml: `<div class="repo-media-preview"><img src="${file.content}" alt="${fileNode.name}"></div>`,
        }));
        return;
      }

      if (/\.(md|markdown)$/i.test(fileNode.path)) {
        const markdown = rewriteReadmeAssets(file.content, state.owner, state.repo, state.branch);
        setState((current) => ({
          ...current,
          fileHtml: `<div class="post-content repo-markdown">${markdownToHtml(markdown)}</div>`,
        }));
        return;
      }

      setState((current) => ({
        ...current,
        fileHtml: `<pre class="repo-code-block"><code>${escapeHtml(fixText(file.content))}</code></pre>`,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        fileHtml: `<p class="repo-empty-state">${escapeHtml(error.message)}</p>`,
      }));
    }
  }

  async function copyCloneUrl() {
    const cloneUrl = `https://github.com/${state.owner}/${state.repo}.git`;
    await navigator.clipboard.writeText(cloneUrl);
  }

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={`<b>${heroTitle}</b>`}
        meta={heroMeta}
        heroClassName="hero"
      />
      <main className="project-detail-shell">
        <TransitionLink id="back-to-projects" className="project-back-link" href="/production-projects">
          Back to Production Projects
        </TransitionLink>
        <div className="project-detail-layout">
          <aside className="project-sidebar">
            <div className="project-sidebar-section">
              <h2>Project Actions</h2>
              <div className="project-actions">
                <button
                  className="github-btn"
                  onClick={() => window.open(state.project?.github || `https://github.com/${state.owner}/${state.repo}`, "_blank", "noopener,noreferrer")}
                >
                  GitHub Repo
                </button>
                <button className="github-btn clone-btn" onClick={copyCloneUrl}>
                  Clone
                </button>
              </div>
            </div>
            <div className="project-sidebar-section">
              <h2>Project Files</h2>
              <div id="project-tree" className="repo-tree">
                {state.loading ? <p className="repo-empty-state">Loading repository tree..</p> : null}
                {state.error ? <p className="repo-empty-state">{state.error.message}</p> : null}
                {state.tree ? (
                  <TreeNode node={state.tree} onSelect={handleSelectFile} activePath={state.activePath} />
                ) : null}
              </div>
            </div>
          </aside>
          <section className="project-file-viewer">
            <div className="project-file-viewer-header">
              <h2>{state.fileTitle}</h2>
            </div>
            <div
              id="file-content"
              className="project-file-content"
              dangerouslySetInnerHTML={{ __html: state.fileHtml }}
            ></div>
          </section>
        </div>
        <section className="project-documentation-section">
          <h2>{state.project?.title || "Project Documentation"}</h2>
          <div
            id="project-docs-content"
            className="post-content"
            dangerouslySetInnerHTML={{
              __html: state.docsMarkdown
                ? markdownToHtml(state.docsMarkdown)
                : "<p class='repo-empty-state'>No documentation available for this project yet.</p>",
            }}
          ></div>
          {repoQuery ? (
            <>
              <div className="post-engagement-strip">
                <span className="post-engagement-comments">
                  {formatCount(getEntityStats(engagement.statsMap, "project", state.project?.id || repoQuery).viewCount)} views
                </span>
                <LikeButton
                  entityType="project"
                  entityId={state.project?.id || repoQuery}
                  engagement={engagement}
                  className="detail-like-button"
                />
                <span className="post-engagement-comments">
                  {formatCount(getEntityStats(engagement.statsMap, "project", state.project?.id || repoQuery).commentCount)} comments
                </span>
              </div>
              <CommentsPanel
                entityType="project"
                entityId={state.project?.id || repoQuery}
                engagement={engagement}
                title="Project Comments"
              />
            </>
          ) : null}
        </section>
      </main>
    </Shell>
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function LoadingScreen() {
  usePageSetup("Dexteritycoder");

  return (
    <main className="post-article">
      <p>Loading...</p>
    </main>
  );
}

function AuthPromptModal({ message, onClose }) {
  const navigateWithTransition = useTransitionNavigate();

  if (!message) {
    return null;
  }

  return (
    <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="Authentication required">
      <div className="auth-modal-card">
        <h2>Sign In Required</h2>
        <p>{message}</p>
        <div className="auth-modal-actions">
          <button type="button" className="engagement-submit-btn" onClick={() => navigateWithTransition("/auth")}>
            Open Sign Up / Login
          </button>
          <button type="button" className="engagement-like-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthRoleDropdown({ role, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeInfo, setActiveInfo] = useState("");
  const rootRef = useRef(null);
  const options = [
    { value: "visitor", label: "Visitor", note: "Can like, comment, and maintain a profile." },
    { value: "member", label: "Member", note: "Can publish through a review workflow later." },
    { value: "admin", label: "Admin", note: "Full control, best paired with an allowlist." },
  ];
  const selected = options.find((option) => option.value === role) || options[0];

  useEffect(() => {
    function handleClickOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setActiveInfo("");
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
        setActiveInfo("");
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="auth-role-dropdown" ref={rootRef}>
      <span className="auth-role-select-label">Account type</span>
      <button
        type="button"
        className={`auth-role-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected.label}</span>
        <span className="auth-role-trigger-chevron" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="auth-role-menu" role="listbox" aria-label="Account type options">
          {options.map((option) => (
            <div
              key={option.value}
              className={`auth-role-menu-option${role === option.value ? " is-active" : ""}`}
            >
              <button
                type="button"
                className="auth-role-menu-select"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  setActiveInfo("");
                }}
              >
                <span className="auth-role-menu-label">{option.label}</span>
              </button>
              <button
                type="button"
                className="auth-role-menu-info"
                aria-label={option.note}
                title={option.note}
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveInfo((current) => (current === option.value ? "" : option.value));
                }}
              >
                i
                <span className={`auth-role-menu-tooltip${activeInfo === option.value ? " is-visible" : ""}`}>
                  {option.note}
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AuthPage({ siteData, auth }) {
  const [mode, setMode] = useState("signup");
  const [role, setRole] = useState("visitor");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigateWithTransition = useTransitionNavigate();

  usePageSetup("Sign Up | Dexteritycoder", "post-page");

  useEffect(() => {
    if (auth.user) {
      navigateWithTransition("/account");
    }
  }, [auth.user]);

  async function handleEmailSubmit(event) {
    event.preventDefault();
    auth.setError("");
    auth.setNotice("");

    try {
      if (mode === "signup") {
        await auth.signUpWithEmail({
          displayName,
          email,
          password,
          requestedRole: role,
        });
      } else {
        await auth.signInWithEmail({
          email,
          password,
        });
        navigateWithTransition("/account");
      }
    } catch {
      // Shared auth state already holds the error.
    }
  }

  async function handleProviderSignIn(provider) {
    auth.setError("");
    auth.setNotice("");

    try {
      await auth.signInWithProvider(provider, role);
    } catch {
      // Shared auth state already holds the error.
    }
  }

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml="<b>SIGN</b> UP / <b>LOG IN</b>" titleStyle={{ fontSize: "clamp(1.6rem, 1.4vw + 1rem, 2.4rem)" }} />
      <main className="auth-page-shell">
        <section className="auth-card">
          <div className="auth-mode-switch">
            <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")}>
              Sign Up
            </button>
            <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>
              Log In
            </button>
          </div>

          {!auth.configured ? (
            <div className="auth-help-text">
              <p className="engagement-error">
                Authentication is temporarily unavailable because this site is missing its Supabase project URL and publishable key.
              </p>
              <p>
                Likes and comments can run from the database connection alone, but sign-up and OAuth still need a Supabase project URL and a publishable key so the browser can start an auth session.
              </p>
              <p>
                This site now tries to read those values from the deployed server environment first, using the same runtime pattern as the engagement API.
              </p>
            </div>
          ) : null}
          {auth.error ? <p className="engagement-error">{auth.error}</p> : null}
          {auth.notice ? <p className="auth-success">{auth.notice}</p> : null}

          {auth.configured ? (
            <>
              <div className="auth-role-picker">
                <AuthRoleDropdown role={role} onChange={setRole} />
              </div>

              <div className="auth-provider-grid">
                <button type="button" className="auth-provider-btn" onClick={() => handleProviderSignIn("google")} disabled={!auth.configured || auth.busy}>
                  <span className="auth-provider-icon" aria-hidden="true">
                    <img src="/images/google.svg" alt="" />
                  </span>
                  <span>Continue with Google</span>
                </button>
                <button type="button" className="auth-provider-btn" onClick={() => handleProviderSignIn("github")} disabled={!auth.configured || auth.busy}>
                  <span className="auth-provider-icon" aria-hidden="true">
                    <img src="/images/github.svg" alt="" />
                  </span>
                  <span>Continue with GitHub</span>
                </button>
              </div>

              <div className="auth-divider"><span>or use email</span></div>

              <form className="auth-form" onSubmit={handleEmailSubmit}>
                {mode === "signup" ? (
                  <input
                    type="text"
                    placeholder="Display name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={80}
                    required
                  />
                ) : null}
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={160}
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                />
                <button type="submit" className="auth-submit-btn" disabled={!auth.configured || auth.busy}>
                  {auth.busy ? "Working..." : mode === "signup" ? "Create Account" : "Log In"}
                </button>
              </form>
            </>
          ) : null}

          <div className="auth-help-text">
            <p>Google and GitHub OAuth use Supabase as the callback target, so their client secrets belong in Supabase provider settings, not in frontend code.</p>
            <p>If Google says access is restricted, add your email as a test user or publish the OAuth consent screen before trying again.</p>
            <p>Admin requests are stored, but unrestricted admin access should still be limited with `AUTH_ADMIN_EMAILS`.</p>
          </div>
        </section>
      </main>
    </Shell>
  );
}

function AuthCallbackPage({ siteData, auth }) {
  const navigate = useNavigate();
  usePageSetup("Signing In | Dexteritycoder", "post-page");

  useEffect(() => {
    if (!auth.loading && auth.callbackReady && auth.user) {
      navigate("/account", { replace: true });
    }
  }, [auth.loading, auth.callbackReady, auth.user, navigate]);

  const isWaiting = auth.loading || !auth.callbackReady;

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml="<b>FINISHING</b> SIGN IN" />
      <main className="post-article">
        <p>{isWaiting ? "Completing your sign in..." : auth.error || "Redirecting you to your account..."}</p>
        {!isWaiting && auth.error ? (
          <p>
            Return to <a href="/auth">the auth page</a> and try again after checking your provider setup.
          </p>
        ) : null}
      </main>
    </Shell>
  );
}

function AccountPage({ siteData, auth }) {
  usePageSetup("Account | Dexteritycoder", "post-page");

  if (auth.loading) {
    return (
      <Shell siteData={siteData} auth={auth}>
        <Hero titleHtml="<b>ACCOUNT</b>" />
        <main className="post-article"><p>Loading your account...</p></main>
      </Shell>
    );
  }

  if (!auth.user) {
    return <Navigate to="/auth" replace />;
  }

  const profile = auth.profile || {
    displayName: auth.user.email || "Member",
    email: auth.user.email || "",
    role: "visitor",
    requestedRole: "visitor",
    authProvider: "email",
  };

  const roleCards = {
    admin: [
      "Read, write, update, and delete permissions",
      "Admin panel foundation for site stats and moderation",
      "Future blog/article publishing controls",
    ],
    member: [
      "Member dashboard foundation",
      "Future content submission workflow for admin review",
      "Future suggestions and notifications flow",
    ],
    visitor: [
      "Saved likes and comments through your account",
      "Newsletter subscription enabled by default",
      "Profile-based engagement and future saved activity history",
    ],
  };

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml="<b>YOUR</b> ACCOUNT" />
      <main className="auth-page-shell">
        <section className="auth-card">
          <h2>{profile.displayName}</h2>
          <p className="auth-account-meta">{profile.email}</p>
          <div className="auth-account-grid">
            <div>
              <strong>Role</strong>
              <p>{profile.role}</p>
            </div>
            <div>
              <strong>Requested role</strong>
              <p>{profile.requestedRole}</p>
            </div>
            <div>
              <strong>Provider</strong>
              <p>{profile.authProvider}</p>
            </div>
          </div>
          <div className="auth-dashboard-list">
            {roleCards[profile.role] ? roleCards[profile.role].map((item) => <p key={item}>{item}</p>) : null}
          </div>
          <button type="button" className="engagement-submit-btn" onClick={() => auth.signOutUser().catch(() => {})}>
            Log Out
          </button>
        </section>
      </main>
    </Shell>
  );
}

function formatCommentDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return date.toLocaleString();
}

function LegacyWritingRedirect() {
  const { blogId } = useParams();
  return <Navigate to={`/writings/${encodeURIComponent(blogId || "")}`} replace />;
}

function AppRoutes({ siteData, engagement, auth }) {
  return (
    <Routes>
      <Route path="/" element={<HomePage siteData={siteData} engagement={engagement} auth={auth} />} />
      <Route path="/index.html" element={<Navigate to="/" replace />} />
      <Route path="/works" element={<WorksPage siteData={siteData} engagement={engagement} auth={auth} />} />
      <Route path="/production-projects" element={<WorkMarkdownPage siteData={siteData} slug="production-projects" production engagement={engagement} auth={auth} />} />
      <Route path="/ai-machine-learning" element={<WorkMarkdownPage siteData={siteData} slug="ai-machine-learning" engagement={engagement} auth={auth} />} />
      <Route path="/train-to-thoughts" element={<WorkMarkdownPage siteData={siteData} slug="train-to-thoughts" engagement={engagement} auth={auth} />} />
      <Route path="/available-for-freelancing" element={<WorkMarkdownPage siteData={siteData} slug="available-for-freelancing" engagement={engagement} auth={auth} />} />
      <Route path="/about" element={<AboutPage siteData={siteData} auth={auth} />} />
      <Route path="/contact" element={<ContactPage siteData={siteData} auth={auth} />} />
      <Route path="/donate" element={<DonatePage siteData={siteData} auth={auth} />} />
      <Route path="/writings" element={<BlogListPage siteData={siteData} engagement={engagement} auth={auth} />} />
      <Route path="/writings/:blogId" element={<BlogDetailPage siteData={siteData} engagement={engagement} auth={auth} />} />
      <Route path="/auth" element={<AuthPage siteData={siteData} auth={auth} />} />
      <Route path="/auth/callback" element={<AuthCallbackPage siteData={siteData} auth={auth} />} />
      <Route path="/account" element={<AccountPage siteData={siteData} auth={auth} />} />
      <Route path="/blog" element={<Navigate to="/writings" replace />} />
      <Route path="/blog/:blogId" element={<LegacyWritingRedirect />} />
      <Route path="/project/:owner/:repo" element={<ProjectDetailPage siteData={siteData} engagement={engagement} auth={auth} />} />
      <Route path="/pages/blog.html" element={<Navigate to="/writings" replace />} />
      <Route path="/pages/production-projects.html" element={<Navigate to="/production-projects" replace />} />
      <Route path="/pages/ai-machine-learning.html" element={<Navigate to="/ai-machine-learning" replace />} />
      <Route path="/pages/train-to-thoughts.html" element={<Navigate to="/train-to-thoughts" replace />} />
      <Route path="/pages/available-for-freelancing.html" element={<Navigate to="/available-for-freelancing" replace />} />
      <Route path="/pages/about.html" element={<Navigate to="/about" replace />} />
      <Route path="/pages/contact.html" element={<Navigate to="/contact" replace />} />
      <Route path="/pages/donate.html" element={<Navigate to="/donate" replace />} />
      <Route path="/Blogs/blog-list.html" element={<Navigate to="/writings" replace />} />
      <Route path="/Blogs/blog-detail.html" element={<BlogDetailPage siteData={siteData} engagement={engagement} auth={auth} />} />
      <Route path="/pages/project-detail.html" element={<ProjectDetailPage siteData={siteData} engagement={engagement} auth={auth} />} />
      <Route path="/pages/post1.html" element={<Navigate to="/production-projects" replace />} />
      <Route path="/pages/post2.html" element={<Navigate to="/ai-machine-learning" replace />} />
      <Route path="/pages/post3.html" element={<Navigate to="/train-to-thoughts" replace />} />
      <Route path="/pages/post4.html" element={<Navigate to="/available-for-freelancing" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const { data, error, loading } = useJson("/data/site-content.json");
  const auth = useSupabaseAuth();
  const engagement = useEngagement(auth);

  if (loading) {
    return <LoadingScreen />;
  }

  if (error || !data) {
    return (
      <main className="post-article">
        <p>Failed to load site data.</p>
      </main>
    );
  }

  return (
    <>
      <AppRoutes siteData={data} engagement={engagement} auth={auth} />
      <AuthPromptModal message={auth.promptMessage} onClose={auth.closeAuthPrompt} />
    </>
  );
}
