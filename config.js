// =====================================================
//  Configuración de la app del Coro San Pablo
//  (Estas claves son públicas por diseño: la seguridad
//   la ponen los permisos de la base de datos.)
// =====================================================
window.CORO_CONFIG = {
  // Supabase → Project Settings → API
  SUPABASE_URL: '',
  SUPABASE_KEY: '',   // clave "anon public" o "publishable"

  // EmailJS → aviso por correo cuando alguien se registra
  EMAILJS: {
    SERVICE_ID: '',
    TEMPLATE_ID: '',
    PUBLIC_KEY: ''
  },

  // Dominio interno para convertir el nombre de usuario en un "correo" (no se envía nada aquí)
  EMAIL_DOMAIN: 'corosanpablo.app'
};
