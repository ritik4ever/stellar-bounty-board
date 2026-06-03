import React, { useEffect, useState } from 'react';
import { Card, Skeleton, Tag, Typography, Alert, Button, Space, Rate } from 'antd';
import { GithubOutlined, WarningOutlined, LockOutlined } from '@ant-design/icons';
import { formatDistanceToNow } from 'date-fns';

const { Text, Title, Paragraph } = Typography;

interface GitHubIssueData {
  title: string;
  state: string;
  labels: Array<{ name: string; color: string }>;
  created_at: string;
  html_url: string;
  number: number;
  user: { login: string; avatar_url: string };
}

interface GitHubIssuePreviewCardProps {
  repo: string;
  issueNumber: number;
}

const GitHubIssuePreviewCard: React.FC<GitHubIssuePreviewCardProps> = ({ repo, issueNumber }) => {
  const [issueData, setIssueData] = useState<GitHubIssueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);

  useEffect(() => {
    const fetchIssue = async () => {
      setLoading(true);
      setError(null);
      setIsRateLimited(false);

      try {
        const response = await fetch(
          `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
          {
            headers: {
              Accept: 'application/vnd.github.v3+json',
            },
          }
        );

        if (response.status === 403) {
          setIsRateLimited(true);
          setError('GitHub API rate limit exceeded. Please try again later.');
          return;
        }

        if (response.status === 404) {
          setError('Issue not found. It may be in a private repository or does not exist.');
          return;
        }

        if (!response.ok) {
          setError(`Failed to fetch issue data (HTTP ${response.status})`);
          return;
        }

        const data: GitHubIssueData = await response.json();
        setIssueData(data);
      } catch (err) {
        setError('Network error. Please check your connection and try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchIssue();
  }, [repo, issueNumber]);

  if (loading) {
    return (
      <Card style={{ width: 400, margin: '16px 0' }}>
        <Skeleton active avatar paragraph={{ rows: 3 }} />
      </Card>
    );
  }

  if (error) {
    return (
      <Card style={{ width: 400, margin: '16px 0' }}>
        <Alert
          message="Issue Load Error"
          description={
            <Space direction="vertical">
              <Text>{error}</Text>
              {isRateLimited && (
                <Text type="secondary">
                  <WarningOutlined /> Unauthenticated requests are limited to 60 per hour.
                </Text>
              )}
              <Button
                type="primary"
                icon={<GithubOutlined />}
                href={`https://github.com/${repo}/issues/${issueNumber}`}
                target="_blank"
              >
                View on GitHub
              </Button>
            </Space>
          }
          type="error"
          showIcon
          icon={isRateLimited ? <WarningOutlined /> : <LockOutlined />}
        />
      </Card>
    );
  }

  if (!issueData) return null;

  return (
    <Card
      style={{ width: 400, margin: '16px 0' }}
      actions={[
        <Button
          type="link"
          icon={<GithubOutlined />}
          href={issueData.html_url}
          target="_blank"
          key="github"
        >
          Open on GitHub
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          <Tag color={issueData.state === 'open' ? 'green' : 'red'}>
            {issueData.state.toUpperCase()}
          </Tag>
          <Text type="secondary">#{issueData.number}</Text>
        </Space>

        <Title level={5} style={{ margin: 0 }}>
          {issueData.title}
        </Title>

        <Space wrap>
          {issueData.labels.map((label) => (
            <Tag key={label.name} color={`#${label.color}`}>
              {label.name}
            </Tag>
          ))}
        </Space>

        <Text type="secondary">
          Opened {formatDistanceToNow(new Date(issueData.created_at), { addSuffix: true })} by{' '}
          {issueData.user.login}
        </Text>
      </Space>
    </Card>
  );
};

export default GitHubIssuePreviewCard;
