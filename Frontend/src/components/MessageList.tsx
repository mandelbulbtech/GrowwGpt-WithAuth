import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useConversation } from '../context/ConversationContext';
import rehypeRaw from 'rehype-raw';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachment_ids?: string[];
  image_url?: string;
  document_name?: string;
  document_names?: string[];
  sources?: { [key: string]: { title: string; url: string; snippet?: string } };
}

interface MessageListProps {
  messages: Message[];
}

const formatMessage = (message: string) => {
  // Convert URL Citation lines to markdown links
  let formatted = message.replace(/\n/g, "  \n").replace(/<br>/g, '\n\n');

  // Then remove leading hyphens from the beginning of lines
  formatted = formatted.replace(/^- /gm, '');

  formatted = formatted.replace(/【.*?†source】/g, '');

  formatted = formatted.replace(/URL Citation:.*(\n)?/g, '');

  return formatted;
};

const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const { loadingMessage } = useConversation();
  const [processedMessages, setProcessedMessages] = useState<Message[]>([]);

  // Process messages to ensure document_names persistence
  useEffect(() => {
    const enrichedMessages = messages.map(message => {
      return { 
        ...message,
        role: message.role as 'user' | 'assistant' // Ensure correct typing for all messages
      };
    });

    setProcessedMessages(enrichedMessages);
  }, [messages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [processedMessages, loadingMessage]);

  // Format timestamp
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Render code blocks with syntax highlighting
  const components = {
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <SyntaxHighlighter
          style={atomDark}
          language={match[1]}
          PreTag="div"
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
  };

  return (
    <div className="px-4 md:px-6">
      {processedMessages.map((message, index) => (
        <div
          key={index}
          className={`py-4 ${index !== 0 ? '' : ''}`}
        >
          <div className={`flex items-start ${message.role === 'user' ? 'flex-row-reverse justify-end' : 'flex-row justify-start'}`}>
            {/* Avatar */}
            <div className={`flex-shrink-0 ${message.role === 'user' ? 'mt-1 ml-3 bg-groww-blue/10' : 'mt-1 mr-3 bg-groww-green/10'} p-2 rounded-full`}>
              {message.role === 'assistant' ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-groww-green" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
                  <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-groww-blue" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              )}
            </div>

            {/* Message content */}
            <div className={`flex flex-col ${message.role === 'user' ? 'w-[100%]' : 'w-fit'}`}>
              {/* Message bubble */}
              <div className={`rounded-lg px-3 py-2 ${message.role === 'user'
                ? 'bg-[#446666] text-white ml-auto max-w-[85%] md:max-w-[90%]'
                : 'bg-gray-100 text-groww-black w-fit max-w-[85%] md:max-w-[90%]'
                }`}>
                {/* If there are attachments, show them */}
                {message.document_names && message.document_names.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {message.document_names.map((name, idx) => (
                      <div key={idx} className="bg-gray-100 rounded-md py-1 px-2 text-xs text-gray-700 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        {name}
                      </div>
                    ))}
                  </div>
                )}

                {/* Markdown rendered content */}
                {message.image_url ? (
                  <img
                    src={message.image_url}
                    alt={message.content || 'Generated image'}
                    className="rounded-lg max-w-full max-h-80 object-contain mb-2"
                  />
                ) : (
                  <div className={`prose prose-sm max-w-none extra-spacing ${message.role === 'user' ? 'prose-invert' : ''}`}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        ...components,
                        table: ({ node, ...props }) => (
                          <div className="responsive-table">
                            <table {...props} />
                          </div>
                        ),
                        a: ({ node, ...props }) => {
                          const href =
                            typeof props.href === "string" && !props.href.startsWith("http")
                              ? `https://${props.href}`
                              : props.href;
                          return (
                            <a
                              {...props}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline"
                            >
                              {props.children}
                            </a>
                          );
                        },
                      }}
                    >
                      {formatMessage(message.content)}
                    </ReactMarkdown>
                  </div>
                )}

                {message.sources && Object.values(message.sources).length > 0 && (
                  <div className="mt-2">
                    {Object.values(message.sources).map((source, idx) => (
                      <div key={idx}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline"
                        >
                          [{idx + 1}] {source.title}
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className={`flex items-center mb-1 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <span className="ml-2 text-xs text-gray-400">
                  {formatTime(message.timestamp)}
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Loading message */}
      {loadingMessage && (
        <div className="py-4">
          <div className="flex items-start">
            <div className="flex-shrink-0 mt-1 mr-3 bg-groww-green/10 p-2 rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-groww-green" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
                <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <div className="bg-gray-100 text-groww-black rounded-lg px-3 py-2 w-fit">
                <div className="flex items-center space-x-2">
                  <div className="animate-pulse">Generating response</div>
                  <div className="flex space-x-1">
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invisible element to scroll to */}
      <div ref={endOfMessagesRef} />
    </div>
  );
};

export default MessageList;