// ===== Meta Graph API Client =====
// Sends messages via WhatsApp Cloud API and Instagram Messaging API

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Send a WhatsApp message via Cloud API
 * Requires env vars: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 */
async function sendWhatsAppMessage(recipientPhone, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { success: false, error: 'WhatsApp API not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID environment variables.' };
  }

  try {
    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'text',
        text: { body: text },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('WhatsApp send error:', data);
      return { success: false, error: data.error?.message || 'Failed to send WhatsApp message' };
    }

    console.log(`WhatsApp message sent to ${recipientPhone}:`, data.messages?.[0]?.id);
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    console.error('WhatsApp send error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send an Instagram DM via Messaging API
 * Requires env vars: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_PAGE_ID
 */
async function sendInstagramMessage(recipientId, text) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const pageId = process.env.INSTAGRAM_PAGE_ID;

  if (!token) {
    return { success: false, error: 'Instagram API not configured. Set INSTAGRAM_ACCESS_TOKEN environment variable.' };
  }

  try {
    // Instagram uses the Send API (similar to Messenger)
    const endpoint = pageId
      ? `${GRAPH_API_BASE}/${pageId}/messages`
      : `${GRAPH_API_BASE}/me/messages`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Instagram send error:', data);
      return { success: false, error: data.error?.message || 'Failed to send Instagram message' };
    }

    console.log(`Instagram message sent to ${recipientId}:`, data.message_id);
    return { success: true, messageId: data.message_id };
  } catch (err) {
    console.error('Instagram send error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send a message to the appropriate channel
 */
async function sendMessage(channelType, recipientId, text) {
  if (channelType === 'whatsapp') {
    return sendWhatsAppMessage(recipientId, text);
  } else if (channelType === 'instagram') {
    return sendInstagramMessage(recipientId, text);
  } else {
    return { success: false, error: `Unknown channel type: ${channelType}` };
  }
}

/**
 * Check if a channel's API is configured
 */
function isChannelConfigured(channelType) {
  if (channelType === 'whatsapp') {
    return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  } else if (channelType === 'instagram') {
    return !!process.env.INSTAGRAM_ACCESS_TOKEN;
  }
  return false;
}

module.exports = { sendWhatsAppMessage, sendInstagramMessage, sendMessage, isChannelConfigured };
