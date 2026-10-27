import { Link } from "react-router-dom";
import { EmptyState, LinkButton } from "../components/ui";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="panel w-full max-w-lg">
        <EmptyState
          title="Page not found"
          description="The page you opened does not exist, or you don't have access to it."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <LinkButton to="/app/overview">Back to overview</LinkButton>
              <Link to="/app/fdrs" className="text-sm font-medium text-primary hover:underline">
                Browse FDR records
              </Link>
            </div>
          }
        />
      </div>
    </div>
  );
}
