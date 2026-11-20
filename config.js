// =====================================================
//  Configuración de la app del Coro San Pablo
//  (Estas claves son públicas por diseño: la seguridad
//   la ponen los permisos de la base de datos.)
// =====================================================
window.CORO_CONFIG = {
  // Supabase → Project Settings → API
  SUPABASE_URL: 'https://dhuqvjfwkkqtbaellgqj.supabase.co',
  SUPABASE_KEY: 'sb_publishable_DSth3RS29M86a-nVjKav0w_Nc9c5il7',   // clave "anon public" o "publishable"

  // EmailJS → aviso por correo cuando alguien se registra
  EMAILJS: {
    SERVICE_ID: 'service_defhykl',
    TEMPLATE_ID: 'template_a297mb7',
    PUBLIC_KEY: 'oTYwlzDkwRMIvIzhX'
  },

  // Clave pública para los avisos al móvil (la privada está solo en Supabase)
  VAPID_PUBLIC_KEY: 'BB8Iqv3e-T49hb-bkv0gC9En_r2ntP2LyQgUWFI8PRYT7RysjfoegNUJe2UlMc1XEuOyYnbX2CpNY4XZNcU1U2I',

  // Notificaciones al móvil con la app ntfy (suscríbete a este tema)
  NTFY_TOPIC: 'coro-sanpablo-77779a7ed204',

  // Dominio interno para convertir el nombre de usuario en un "correo" (no se envía nada aquí)
  EMAIL_DOMAIN: 'corosanpablo.app'
};
