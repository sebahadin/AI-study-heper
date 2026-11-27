import { Link } from 'react-router-dom';
import { Icon } from './Icon';
export function StudyChatLink({ kind, id }: { kind: 'course' | 'book' | 'note' | 'document'; id: string }) {
  return <span className="study-context-actions"><Link className="btn secondary small study-chat-link" to={`/chat?${kind}=${encodeURIComponent(id)}`}><Icon name="chat" size={17}/>Ask Classmate</Link><Link className="btn secondary small" to={`/study-tools/new?${kind}=${encodeURIComponent(id)}`}><Icon name="spark" size={17}/>Create study material</Link></span>;
}
