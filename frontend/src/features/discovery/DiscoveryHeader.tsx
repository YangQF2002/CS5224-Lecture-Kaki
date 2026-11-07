export default function DiscoveryHeader({ term }: { term?: string }) {
  return (
    <header className="page-heading discover-header">
      <div>
        <p className="eyebrow">Follow your curiosity</p>
        <h1>Discover lectures</h1>
      </div>
      {term && <p className="discover-term">{term}</p>}
    </header>
  )
}
