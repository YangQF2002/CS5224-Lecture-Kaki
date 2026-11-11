export default function DiscoveryHeader({ term }: { term?: string }) {
  return (
    <header className="page-heading discover-header">
      <div>
        <p className="eyebrow">Follow your curiosity</p>
        <h1>Discover lectures</h1>
      </div>
      {term && <p className="discover-term">{term}</p>}
      <p className="discover-disclaimer">
        <strong>Sitting in on a module you’re not taking?</strong> Please ask
        the lecturer for permission first. Attending is subject to NUS policies
        and each lecturer’s discretion. LectureKaki helps you find lectures and
        people to go with; it doesn’t grant access to them.
      </p>
    </header>
  )
}
