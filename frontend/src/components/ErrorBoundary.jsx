import { Component } from 'react';
import ErrorPage from '../pages/public/ErrorPage.jsx';

/** Catches rendering errors and shows the branded 500 page instead of a blank screen. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('ACHIEVER UI error', error);
  }

  render() {
    if (this.state.error) return <ErrorPage kind="500" onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
