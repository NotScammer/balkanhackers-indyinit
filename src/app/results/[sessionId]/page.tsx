import InterviewApp from "../../../components/InterviewApp";
export default async function Page({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <InterviewApp sessionId={sessionId} results />;
}
