// ================== Autenticación ==================
// Pantalla de login con Firebase Authentication (correo + clave). Mientras
// no haya una sesión válida, esta pantalla cubre toda la app (ver CSS
// .login-overlay en index.html) y ningún otro módulo llega a leer ni
// escribir en Firestore.
//
// Los demás archivos (pedidos.js, clientes.js, etc.) NO se suscriben a
// Firestore por su cuenta al cargar la página — esperan al evento
// 'auth:listo', que este archivo dispara una sola vez, justo después de
// confirmar que hay sesión iniciada (recién autenticado, o porque el
// navegador ya tenía la sesión guardada de una visita anterior).

(function () {
  const pantallaLogin  = document.getElementById('pantalla-login');
  const loginCargando  = document.getElementById('login-cargando');
  const loginMetodos   = document.getElementById('login-metodos');
  const formLogin      = document.getElementById('form-login');
  const inputCorreo    = document.getElementById('login-correo');
  const inputClave     = document.getElementById('login-clave');
  const loginError     = document.getElementById('login-error');
  const btnLogin       = formLogin.querySelector('button[type="submit"]');
  const btnGoogleLogin = document.getElementById('btn-google-login');

  const infoUsuarioCorreo = document.getElementById('sidebar-usuario-correo');
  const btnCerrarSesion   = document.getElementById('btn-cerrar-sesion');

  const CLAVE_RECORDAR_CORREO = 'edisatech_ultimo_correo';

  // Mantiene la sesión iniciada entre recargas y cierres del navegador
  // (equivalente a "recordarme"), hasta que alguien pulse "Cerrar sesión".
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

  // Recuerda el último correo usado, para no tener que volver a escribirlo
  // cada vez que se cierra sesión.
  const correoGuardado = localStorage.getItem(CLAVE_RECORDAR_CORREO);
  if (correoGuardado) inputCorreo.value = correoGuardado;

  let yaDisparado = false; // 'auth:listo' se dispara una sola vez por sesión

  // Que Firebase Authentication acepte el login solo confirma que la
  // persona es quien dice ser — no que tenga permiso de usar el sistema.
  // Eso se verifica aparte, leyendo su documento en /usuarios/{uid}, que es
  // exactamente lo mismo que exige la regla de seguridad de Firestore. Si
  // no existe (o no tiene rol "normal"), esta lectura la rechaza Firestore
  // con "permission-denied" — eso es justo la señal de "no autorizado".
  async function tieneAccesoAutorizado(user) {
    try {
      const doc = await db.collection('usuarios').doc(user.uid).get();
      return doc.exists && doc.data().rol === 'normal';
    } catch (err) {
      return false;
    }
  }

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      loginCargando.style.display = 'none';
      loginMetodos.style.display = 'block';
      pantallaLogin.classList.add('open');
      return;
    }

    // Se ve la pantalla de "Cargando" también durante esta verificación
    // (además del chequeo inicial de sesión guardada), para no mostrar la
    // app ni un solo instante antes de confirmar que tiene permiso.
    loginMetodos.style.display = 'none';
    loginCargando.textContent = 'Verificando acceso...';
    loginCargando.style.display = 'block';

    const autorizado = await tieneAccesoAutorizado(user);

    if (!autorizado) {
      await firebase.auth().signOut();
      loginCargando.style.display = 'none';
      loginMetodos.style.display = 'block';
      pantallaLogin.classList.add('open');
      loginError.textContent = 'Esta cuenta no tiene acceso a este sistema. Contacta al administrador.';
      return;
    }

    loginCargando.style.display = 'none';
    pantallaLogin.classList.remove('open');
    if (infoUsuarioCorreo) infoUsuarioCorreo.textContent = user.email;

    if (!yaDisparado) {
      yaDisparado = true;
      document.dispatchEvent(new CustomEvent('auth:listo', { detail: { user } }));
    }
  });

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';

    const correo = inputCorreo.value.trim();
    const clave = inputClave.value;
    if (!correo || !clave) return;

    btnLogin.disabled = true;
    btnLogin.textContent = 'Ingresando...';
    try {
      await firebase.auth().signInWithEmailAndPassword(correo, clave);
      localStorage.setItem(CLAVE_RECORDAR_CORREO, correo);
      inputClave.value = '';
    } catch (err) {
      console.error('Error de inicio de sesión:', err);
      loginError.textContent = mensajeError(err.code);
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Ingresar';
    }
  });

  const proveedorGoogle = new firebase.auth.GoogleAuthProvider();

  btnGoogleLogin.addEventListener('click', async () => {
    loginError.textContent = '';
    btnGoogleLogin.disabled = true;
    try {
      await firebase.auth().signInWithPopup(proveedorGoogle);
      // onAuthStateChanged se encarga de cerrar la pantalla de login.
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error('Error de inicio de sesión con Google:', err);
        loginError.textContent = mensajeError(err.code);
      }
    } finally {
      btnGoogleLogin.disabled = false;
    }
  });

  function mensajeError(code) {
    switch (code) {
      case 'auth/invalid-email':
        return 'El correo no es válido.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Correo o clave incorrectos.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
      case 'auth/network-request-failed':
        return 'Sin conexión a internet.';
      case 'auth/popup-blocked':
        return 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes e inténtalo de nuevo.';
      case 'auth/unauthorized-domain':
        return 'Este dominio no está autorizado en Firebase para iniciar sesión con Google.';
      case 'auth/account-exists-with-different-credential':
        return 'Ese correo ya está registrado con otro método de acceso (correo/clave).';
      default:
        return 'No se pudo iniciar sesión. Revisa la consola.';
    }
  }

  if (btnCerrarSesion) {
    btnCerrarSesion.addEventListener('click', async () => {
      await firebase.auth().signOut();
      // Recarga limpia: reinicia todos los cachés y suscripciones de los
      // demás módulos en vez de tener que desconectarlos uno por uno.
      location.reload();
    });
  }
})();
