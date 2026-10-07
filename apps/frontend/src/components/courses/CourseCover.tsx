import { useState } from 'react';
import { coverTone } from '../../lib/courses';
import { Icon } from '../ui';

interface CourseCoverProps {
  title: string;
  category: string;
  coverUrl: string | null;
  /** card: shallow 16:7 banner · hero: 16:9 panel on the course page. */
  variant?: 'card' | 'hero';
}

/**
 * Course cover: the uploaded image (time-limited S3 link) or, when there is
 * none or it cannot load, a calm placeholder tinted by category.
 */
export function CourseCover({ title, category, coverUrl, variant = 'card' }: CourseCoverProps) {
  const [failed, setFailed] = useState(false);
  const showImage = !!coverUrl && !failed;
  return (
    <div className={`cq-cover cq-cover--${variant}${showImage ? '' : ` cq-cover--${coverTone(category)}`}`}>
      {showImage ? (
        <img src={coverUrl!} alt={`Cover image for ${title}`} onError={() => setFailed(true)} />
      ) : (
        <span className="cq-cover__placeholder" aria-hidden="true">
          <Icon name="course" size={variant === 'hero' ? 44 : 32} />
        </span>
      )}
      <span className="cq-cover__category">{category}</span>
    </div>
  );
}
