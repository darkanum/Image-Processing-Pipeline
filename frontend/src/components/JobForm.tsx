import { useState, type FormEvent } from "react";

interface JobFormProps {
  apiUrl: string;
  onCreated?: (job: { id: string }) => void;
}

export const JobForm = ({ apiUrl, onCreated }: JobFormProps): JSX.Element => {
  const [url, setUrl] = useState<string>("https://picsum.photos/800/600");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const job = (await res.json()) as { id: string };
      onCreated?.(job);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="job-form" onSubmit={handleSubmit}>
      <label htmlFor="job-url">Image URL</label>
      <div className="row">
        <input
          id="job-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/cat.jpg"
          required
          disabled={submitting}
        />
        <button type="submit" disabled={submitting || url.trim().length === 0}>
          {submitting ? "Submitting…" : "Process image"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="hint">
        Tries:&nbsp;
        <button type="button" className="link" onClick={() => setUrl("https://picsum.photos/seed/pipeline/1200/800")}>
          random 1200x800
        </button>
        &nbsp;·&nbsp;
        <button type="button" className="link" onClick={() => setUrl("https://picsum.photos/200/200")}>
          small 200x200
        </button>
        &nbsp;·&nbsp;
        <button type="button" className="link" onClick={() => setUrl("https://example.com/missing.png")}>
          404
        </button>
        &nbsp;·&nbsp;
        <button type="button" className="link" onClick={() => setUrl("https://example.com")}>
          non-image
        </button>
      </div>
    </form>
  );
};
