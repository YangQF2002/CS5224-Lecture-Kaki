import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import Icon from '../../Icon.tsx'
import {
  SignInRequired,
  getAccessToken,
  subscribeToSignOut,
} from '../forum/auth.ts'
import {
  getProfile,
  loadLocalTopics,
  subscribeToTopicUpdates,
} from './profileApi.ts'

// Shown before any topics are picked.
const SUGGESTED_TOPICS = ['AI & Machine Learning', 'Psychology', 'Arts & Media']
// Keeps the sidebar short; the Profile page lists every saved topic.
const MAX_TOPICS = 5
const DOT_COLOURS = ['sage', 'clay', 'lavender']

/** The "Follow your curiosity" links: the user's saved topics, if any. */
export default function SidebarTopics() {
  const { pathname } = useLocation()
  // null until the profile has loaded (or failed), to avoid a flash of
  // suggestions before the saved topics appear.
  const [saved, setSaved] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    let updated = false
    const stopTopicUpdates = subscribeToTopicUpdates((topics) => {
      updated = true
      if (!cancelled) setSaved(topics)
    })
    // Signed out, the topics picked in this browser are shown instead.
    const stopSignOut = subscribeToSignOut(() => {
      if (!cancelled) setSaved(loadLocalTopics())
    })
    getProfile(getAccessToken)
      .then((profile) => {
        if (!cancelled && !updated) setSaved(profile.topics)
      })
      .catch((cause: unknown) => {
        if (cancelled || updated) return
        // Other errors keep what is already shown.
        setSaved((current) =>
          cause instanceof SignInRequired
            ? loadLocalTopics()
            : (current ?? loadLocalTopics()),
        )
      })
    return () => {
      cancelled = true
      stopTopicUpdates()
      stopSignOut()
    }
    // Reload on navigation, e.g. after returning from sign-in.
  }, [pathname])

  if (saved === null) return null
  const hasSaved = saved.length > 0
  const topics = hasSaved ? saved.slice(0, MAX_TOPICS) : SUGGESTED_TOPICS
  const more = saved.length - topics.length

  return (
    <>
      {topics.map((topic, index) => (
        <Link key={topic} to={`/?${new URLSearchParams({ topics: topic })}`}>
          <span
            className={`subject-dot ${DOT_COLOURS[index % DOT_COLOURS.length]}`}
          />
          {topic}
        </Link>
      ))}
      <Link className="sidebar-interests" to="/profile">
        <Icon name="plus" />
        {!hasSaved
          ? 'Choose your interests'
          : more > 0
            ? `Edit interests (${more} more)`
            : 'Edit your interests'}
      </Link>
    </>
  )
}
