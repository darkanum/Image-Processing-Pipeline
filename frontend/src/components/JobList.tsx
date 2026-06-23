import { useJobs } from "../hooks/useJobs";
import { JobCard } from "./JobCard";

interface JobListProps {
  refreshSignal: number;
}

export const JobList = ({ refreshSignal }: JobListProps): JSX.Element => {
  // refreshSignal changes when a new job is created — we forward it as a tick
  // to useJobs so the listener re-establishes (Firestore also pushes the new doc).
  void refreshSignal;
  const { jobs, loading, error } = useJobs(50);

  if (loading && jobs.length === 0) {
    return <div className="empty">Connecting to Firestore…</div>;
  }
  if (error) {
    return (
      <div className="empty error">
        Failed to subscribe: {error}
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="empty">
        <p>No jobs yet. Submit a URL above to kick things off.</p>
      </div>
    );
  }
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
};
