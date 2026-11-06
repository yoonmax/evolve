import { Component } from 'react'

// A failed section must not take running evolution with it: sessions and saved data live
// outside React, so the rest of the application carries on.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty" role="alert">
        <p>This section stopped working: {this.state.error.message}</p>
        <p>Any running experiment and your saved creatures are unaffected.</p>
        <div className="row">
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="btn" onClick={() => location.reload()}>Reload the page</button>
        </div>
      </div>
    )
  }
}
