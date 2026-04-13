import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../components/card';

describe('Card', () => {
  it('composes header, content, and footer', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Hello</CardTitle>
        </CardHeader>
        <CardContent>Body content here</CardContent>
        <CardFooter>Footer text</CardFooter>
      </Card>,
    );

    expect(screen.getByTestId('card')).toBeDefined();
    expect(screen.getByText('Hello')).toBeDefined();
    expect(screen.getByText('Body content here')).toBeDefined();
    expect(screen.getByText('Footer text')).toBeDefined();
  });

  it('applies card background color class', () => {
    render(<Card data-testid="card">contents</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-card');
  });
});
