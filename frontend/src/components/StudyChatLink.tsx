import { Link } from 'react-router-dom';
import { Icon } from './Icon';
export function StudyChatLink({ kind, id }: { kind: 'course' | 'book' | 'note' | 'document'; id: string }) {
  return <Link className="btn secondary small study-chat-link" to={`/chat?${kind}=${encodeURIComponent(id)}`}><Icon name="chat" size={17}/>Ask Classmate</Link>;
}
