// React Integration Examples for Purifai

import React, { useState, useMemo } from 'react';
import { Purifai, sanitize, analyze } from 'purifai';

// 1. Basic React component with sanitization
function UserComment({ comment }) {
  const sanitizedComment = useMemo(() => {
    return sanitize(comment.text);
  }, [comment.text]);

  return (
    <div className="user-comment">
      <h4>{comment.author}</h4>
      <div dangerouslySetInnerHTML={{ __html: sanitizedComment }} />
    </div>
  );
}

// 2. Real-time input sanitization with threat detection
function SecureTextEditor() {
  const [input, setInput] = useState('');
  const [analysis, setAnalysis] = useState(null);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);
    
    // Real-time threat analysis
    const result = analyze(value);
    setAnalysis(result);
  };

  return (
    <div className="secure-editor">
      <textarea
        value={input}
        onChange={handleInputChange}
        placeholder="Type your content here..."
        className="editor-input"
      />
      
      <div className="threat-indicator">
        {analysis && (
          <>
            <div className={`threat-level ${analysis.threatLevel}`}>
              Threat Level: {analysis.threatLevel}
            </div>
            {analysis.hadThreats && (
              <div className="warning">
                ⚠️ Dangerous content detected and will be sanitized
              </div>
            )}
          </>
        )}
      </div>
      
      <div className="preview">
        <h4>Safe Preview:</h4>
        <div dangerouslySetInnerHTML={{ 
          __html: analysis ? analysis.content : '' 
        }} />
      </div>
    </div>
  );
}

// 3. Custom hook for sanitization
function useSanitize(content, options = {}) {
  return useMemo(() => {
    if (!content) return '';
    return Purifai.sanitize(content, options);
  }, [content, options]);
}

// 4. Blog post component with secure content rendering
function BlogPost({ post }) {
  const sanitizedTitle = useSanitize(post.title);
  const sanitizedContent = useSanitize(post.content, {
    allowBasicHtml: true // Allow some HTML for formatting
  });

  return (
    <article className="blog-post">
      <h1 dangerouslySetInnerHTML={{ __html: sanitizedTitle }} />
      <div 
        className="blog-content"
        dangerouslySetInnerHTML={{ __html: sanitizedContent }} 
      />
    </article>
  );
}

// 5. Form with validation and sanitization
function SecureContactForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: ''
  });
  const [threats, setThreats] = useState({});

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Check for threats in real-time
    const analysis = analyze(value);
    setThreats(prev => ({
      ...prev,
      [field]: analysis.hadThreats ? analysis.threatLevel : null
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Sanitize all form data before submission
    const sanitizedData = {
      name: sanitize(formData.name),
      email: sanitize(formData.email),
      message: sanitize(formData.message)
    };

    console.log('Submitting sanitized data:', sanitizedData);
    // Submit to your API...
  };

  return (
    <form onSubmit={handleSubmit} className="secure-form">
      <div className="form-field">
        <label htmlFor="name">Name:</label>
        <input
          id="name"
          type="text"
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          className={threats.name ? 'threat-detected' : ''}
        />
        {threats.name && (
          <div className="threat-warning">
            Security threat detected in name field
          </div>
        )}
      </div>

      <div className="form-field">
        <label htmlFor="email">Email:</label>
        <input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => handleInputChange('email', e.target.value)}
          className={threats.email ? 'threat-detected' : ''}
        />
        {threats.email && (
          <div className="threat-warning">
            Security threat detected in email field
          </div>
        )}
      </div>

      <div className="form-field">
        <label htmlFor="message">Message:</label>
        <textarea
          id="message"
          value={formData.message}
          onChange={(e) => handleInputChange('message', e.target.value)}
          className={threats.message ? 'threat-detected' : ''}
        />
        {threats.message && (
          <div className="threat-warning">
            Security threat detected in message field
          </div>
        )}
      </div>

      <button type="submit">Send Secure Message</button>
    </form>
  );
}

// 6. Higher-order component for automatic sanitization
function withSanitization(WrappedComponent, options = {}) {
  return function SanitizedComponent(props) {
    const sanitizedProps = useMemo(() => {
      const sanitized = {};
      
      Object.keys(props).forEach(key => {
        if (typeof props[key] === 'string') {
          sanitized[key] = Purifai.sanitize(props[key], options);
        } else {
          sanitized[key] = props[key];
        }
      });
      
      return sanitized;
    }, [props]);

    return <WrappedComponent {...sanitizedProps} />;
  };
}

// Usage of HOC
const SecureUserProfile = withSanitization(({ name, bio, website }) => (
  <div className="user-profile">
    <h2 dangerouslySetInnerHTML={{ __html: name }} />
    <p dangerouslySetInnerHTML={{ __html: bio }} />
    <a href={website} dangerouslySetInnerHTML={{ __html: website }} />
  </div>
));

export {
  UserComment,
  SecureTextEditor,
  useSanitize,
  BlogPost,
  SecureContactForm,
  withSanitization,
  SecureUserProfile
};