export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function rawJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
  });

  return {
    ok: response.ok,
    status: response.status,
    data: await response.json().catch(() => ({})),
  };
}
