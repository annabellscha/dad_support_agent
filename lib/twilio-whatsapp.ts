import twilio from "twilio";

export type TwilioWebhookParams = Record<string, string>;

function pickForwardedHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function getTwilioWebhookParams(formData: FormData): TwilioWebhookParams {
  const params: TwilioWebhookParams = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      params[key] = value;
    }
  }

  return params;
}

export function getPublicWebhookUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProtocol = pickForwardedHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  const forwardedHost =
    pickForwardedHeaderValue(request.headers.get("x-forwarded-host")) ||
    pickForwardedHeaderValue(request.headers.get("host"));

  if (forwardedProtocol) {
    url.protocol = `${forwardedProtocol}:`;
  }

  if (forwardedHost) {
    url.host = forwardedHost;
  }

  return url.toString();
}

export function isValidTwilioWebhookRequest(
  request: Request,
  params: TwilioWebhookParams,
  authToken: string,
) {
  const signature = request.headers.get("x-twilio-signature");

  if (!signature) {
    return false;
  }

  return twilio.validateRequest(
    authToken,
    signature,
    getPublicWebhookUrl(request),
    params,
  );
}

export function buildTwilioMessagingResponse(message: string) {
  const response = new twilio.twiml.MessagingResponse();
  response.message(message);
  return response.toString();
}
