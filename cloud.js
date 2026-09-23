
"use strict";

// PAPELERA ACCORD
// Conexión con Supabase e inicio de sesión.

const cloud = (() => {
  let client;
  let revision = null;
  let signedIn = false;
  let busy = false;

  const DOCUMENT_ID = "00000000-0000-0000-0000-000000000001";

  const errorText = error =>
    error?.message || "No se pudo conectar con Supabase.";

  function report(message) {
    document.querySelector("#loginError").textContent = message;
  }

  function configured() {
    const config = window.ACCORD_CONFIG;

    return (
      config &&
      /^https:\/\/[^/]+\.supabase\.co\/?$/.test(config.url) &&
      typeof config.publishableKey === "string" &&
      config.publishableKey.startsWith("sb_publishable_")
    );
  }

  // LEER EL INVENTARIO DE LA NUBE
  async function fetchDocument() {
    const { data, error } = await client
      .from("inventory_documents")
      .select("payload,revision")
      .eq("id", DOCUMENT_ID)
      .single();

    if (error) {
      throw error;
    }

    return {
      payload: data.payload,
      revision: data.revision
    };
  }

  async function load() {
    const document = await fetchDocument();

    revision = document.revision;

    return document.payload;
  }

  // GUARDAR CAMBIOS EN SUPABASE
  async function commit(payload) {
    const { data, error } = await client.rpc("commit_inventory", {
      expected_revision: revision,
      new_payload: payload
    });

    if (error) {
      throw error;
    }

    // Otro dispositivo modificó los datos primero.
    if (data === null) {
      return false;
    }

    revision = data;

    return true;
  }

  // ABRIR EL SISTEMA DESPUÉS DEL LOGIN
  async function enter() {
    if (busy) return;

    busy = true;

    try {
      const data = await load();

      window.startAccordApp(data);

      document.body.classList.remove("locked");

      signedIn = true;

      report("");
    } catch (error) {
      signedIn = false;

      document.body.classList.add("locked");

      report(
        "Tu cuenta no tiene acceso al inventario o falta configurar " +
        "la base de datos: " +
        errorText(error)
      );
    } finally {
      busy = false;
    }
  }

  // ACTUALIZAR DATOS DESDE OTRO DISPOSITIVO
  async function refresh() {
    if (
      !signedIn ||
      busy ||
      document.body.classList.contains("cloud-busy")
    ) {
      return;
    }

    try {
      const data = await load();

      window.acceptCloudUpdate(data);
    } catch (error) {
      console.error("Error de sincronización:", error);

      window.showCloudError?.(
        "No se pudieron actualizar los datos. Revisá tu conexión a Internet."
      );
    }
  }

  // CERRAR SESIÓN
  async function logout() {
    const { error } = await client.auth.signOut();

    if (error) {
      window.showCloudError?.(errorText(error));
      return;
    }

    location.reload();
  }

  // INICIAR LA CONEXIÓN
  async function init() {
    const form = document.querySelector("#loginForm");

    document
      .querySelector("#logoutButton")
      .addEventListener("click", logout);

    // CAMBIAR CONTRASEÑA
    document
      .querySelector("#changePasswordButton")
      .addEventListener("click", async () => {
        const password = prompt(
          "Ingresá tu NUEVA contraseña (mínimo 12 caracteres):"
        );

        if (password === null) return;

        if (password.length < 12) {
          window.showCloudError?.(
            "La contraseña debe tener al menos 12 caracteres."
          );
          return;
        }

        const { error } = await client.auth.updateUser({
          password
        });

        if (error) {
          window.showCloudError?.(
            "No se cambió la contraseña: " + errorText(error)
          );
        } else {
          window.showCloudSuccess?.(
            "Contraseña actualizada."
          );
        }
      });

    // BOTÓN DE ACTUALIZACIÓN
    document
      .querySelector("#refreshCloud")
      .addEventListener("click", refresh);

    // COMPROBAR CONFIGURACIÓN
    if (
      !configured() ||
      !window.supabase?.createClient
    ) {
      report(
        "Configurá config.js con la URL y la clave publicable " +
        "de Supabase y verificá tu conexión a Internet."
      );

      form.querySelector("button").disabled = true;

      return;
    }

    // CREAR CLIENTE SUPABASE
    client = window.supabase.createClient(
      window.ACCORD_CONFIG.url,
      window.ACCORD_CONFIG.publishableKey,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true
        }
      }
    );

    // INICIO DE SESIÓN
    form.addEventListener("submit", async event => {
      event.preventDefault();

      const button = document.querySelector("#loginButton");

      button.disabled = true;

      report("Ingresando...");

      try {
        const { error } = await client.auth.signInWithPassword({
          email: document
            .querySelector("#loginEmail")
            .value.trim(),

          password: document
            .querySelector("#loginPassword")
            .value
        });

        if (error) {
          throw error;
        }

        document.querySelector("#loginPassword").value = "";

        await enter();
      } catch (error) {
        report(errorText(error));
      } finally {
        button.disabled = false;
      }
    });

    // RECUPERAR SESIÓN SI YA HABÍA INGRESADO
    const { data, error } = await client.auth.getUser();

    if (!error && data.user) {
      await enter();
    }

    // DETECTAR CIERRE DE SESIÓN
    client.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") {
        signedIn = false;

        document.body.classList.add("locked");
      }
    });

    // ACTUALIZAR AL VOLVER A LA PESTAÑA
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refresh();
      }
    });

    // COMPROBAR CAMBIOS CADA 20 SEGUNDOS
    setInterval(refresh, 20000);
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    commit,
    refresh,
    load
  };
})();