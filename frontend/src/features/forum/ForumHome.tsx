import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import './forum.css'

export default function ForumHome() {
  const [roomId, setRoomId] = useState('')
  const navigate = useNavigate()
  return (
    <main className="forum-page">
      <header>
        <h1>Lecture Forum</h1>
        <p>
          Open a lecture discussion using its room ID. Messages disappear after
          24 hours.
        </p>
      </header>
      <p>
        <Link to="/">Browse lectures</Link>
      </p>
      <p>If someone shared a room ID with you, enter it below.</p>
      <form
        className="panel composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (roomId.trim())
            void navigate(`/forum/${encodeURIComponent(roomId.trim())}`)
        }}
      >
        <label htmlFor="room-id">Room ID</label>
        <input
          id="room-id"
          value={roomId}
          onChange={(event) => setRoomId(event.target.value)}
          required
          placeholder="BT1101-LEC-1@2026-10-20-0800-LT11@2026-2027@1"
        />
        <button type="submit">Open discussion</button>
      </form>
    </main>
  )
}
